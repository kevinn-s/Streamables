// src/bun/features/export.ts - Bun main only, jangan di-import dari webview

import { invokeResolveMethod } from "../resolve";

export type TrimExportRequest = {
    videoId: string;
    start: number; // detik, dari startRange store
    end: number; // detik, dari endRange store
    duration?: number;
    outputDir: string; // folder pilihan user, harus sudah ada
    title?: string;
};

export type TrimExportStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TrimExportJob = {
    id: string;
    videoId: string;
    start: number;
    end: number;
    outputPath: string;
    status: TrimExportStatus;
    progress: number; // 0-100
    error?: string;
};

// Internal, tidak dikirim ke webview
type InternalJob = TrimExportJob & {
    proc: ReturnType<typeof Bun.spawn>;
    stderr: string;
    done: Promise<TrimExportJob>;
    resolveDone: (job: TrimExportJob) => void;
};

const jobs = new Map<string, InternalJob>();

function formatSectionTime(t: number): string {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatSectionRange(start: number, end: number): string {
    return `*${formatSectionTime(start)}-${formatSectionTime(end)}`;
}

export function validateTrimRange(start: number, end: number, duration?: number): void {
    if (!isFinite(start) || !isFinite(end)) throw new Error('start/end tidak valid');
    if (start < 0) throw new Error('start < 0');
    if (duration !== undefined && end > duration) throw new Error('end melebihi durasi');
    if (end - start < 0.5) throw new Error('range terlalu pendek, minimal 0.5 detik');
    if (start >= end) throw new Error('start harus < end');
}

export function sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'clip';
}

export function buildOutputPath(req: TrimExportRequest): string {
    const base = sanitizeFilename(req.title ?? req.videoId);
    const file = `${base}_${Math.floor(req.start)}-${Math.floor(req.end)}.mp4`;
    const dir = req.outputDir.replace(/[\\/]+$/, '');
    return `${dir}/${file}`;
}

export function buildYtDlpArgs(req: TrimExportRequest, outputPath: string): string[] {
    return [
        'yt-dlp',
        '--download-sections', formatSectionRange(req.start, req.end),
        '--force-keyframes-at-cuts',
        '--force-overwrites',
        '--no-continue',
        '-f', 'bestvideo+bestaudio/best',
        '-o', outputPath,
        `https://www.youtube.com/watch?v=${req.videoId}`,
    ];
}

export function parseYtDlpProgress(line: string): number | null {
    const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
    return m ? Number(m[1]) : null;
}

function toPublic(job: InternalJob): TrimExportJob {
    const { id, videoId, start, end, outputPath, status, progress, error } = job;
    return { id, videoId, start, end, outputPath, status, progress, error };
}

export type PerformTrimExportResult = {
    job: TrimExportJob;
    importResult: unknown | null;
    timeline: string;
    trackIndex: number;
};
function parseTrackIndex(track: string): number {
    const digits = track.replace(/\D/g, "");
    const index = digits ? parseInt(digits, 10) : NaN;
    if (!Number.isFinite(index) || index < 1) {
        throw new Error(`track tidak valid: ${track} (harapkan misalnya "V1", "V2", atau "2")`);
    }
    return index;
}
export async function performTrimExport(
    timeline: string,
    track: string,
    videoId: string,
    start: string,
    end: string,
    directory: string,
    onProgress?: (job: TrimExportJob) => void,
): Promise<PerformTrimExportResult> {
    const startNum = Number(start);
    const endNum = Number(end);
    if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) {
        throw new Error(`start/end tidak valid: ${start} - ${end}`);
    }
    if (!timeline) throw new Error("timeline belum dipilih");
    if (!directory) throw new Error("directory belum dipilih");
    const trackIndex = parseTrackIndex(track);
    // 1. Start download, langsung dapat job running (tidak menunggu selesai di sini).
    const started = startTrimExport({
        videoId,
        start: startNum,
        end: endNum,
        outputDir: directory,
        // title tidak ada di signature ini, jadi buildOutputPath pakai videoId sebagai fallback.
    });
    // 2. Watchover progress saja via setInterval, BUKAN untuk menunggu selesai.
    // Completion tetap lewat waitTrimExport di bawah, supaya interval tidak jadi penentu.
    const interval = onProgress
        ? setInterval(() => {
            const current = getTrimExport(started.id);
            if (current) onProgress(current);
        }, 500)
        : undefined;
    try {
        const finalJob = await waitTrimExport(started.id);
        // 3. Cancelled / failed: jangan import sama sekali.
        if (finalJob.status === "cancelled") {
            return { job: finalJob, importResult: null, timeline, trackIndex };
        }
        if (finalJob.status !== "completed") {
            throw new Error(finalJob.error ?? `export gagal dengan status ${finalJob.status}`);
        }
        // 4. Pastikan file hasil download benar-benar ada sebelum import.
        // yt-dlp exit 0 saja belum cukup kalau -o / ext-nya meleset.
        if (!(await Bun.file(finalJob.outputPath).exists())) {
            throw new Error(`file hasil export tidak ditemukan: ${finalJob.outputPath}`);
        }
        // 5. Baru sekarang import ke Resolve, ke timeline + track yang dipilih user.
        // Timeout lebih panjang karena ini mutating call, bukan query.
        const importResult = await invokeResolveMethod(
            "ImportClipToTrack",
            { filePath: finalJob.outputPath, trackIndex, timeline },
            15000,
        );
        return { job: finalJob, importResult, timeline, trackIndex };
    } finally {
        if (interval !== undefined) clearInterval(interval);
    }
}

export function startTrimExport(req: TrimExportRequest): TrimExportJob {
    validateTrimRange(req.start, req.end, req.duration);
    const outputPath = buildOutputPath(req);
    const args = buildYtDlpArgs(req, outputPath);

    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });

    let resolveDone!: (job: TrimExportJob) => void;
    const done = new Promise<TrimExportJob>((r) => { resolveDone = r; });

    const job: InternalJob = {
        id: crypto.randomUUID(),
        videoId: req.videoId,
        start: req.start,
        end: req.end,
        outputPath,
        status: 'running',
        progress: 0,
        proc,
        stderr: '',
        done,
        resolveDone,
    };
    jobs.set(job.id, job);

    void (async () => {
        try {
            const reader = proc.stderr.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done: streamDone, value } = await reader.read();
                if (streamDone) break;
                const text = decoder.decode(value, { stream: true });
                job.stderr += text;
                for (const line of text.split('\n')) {
                    const p = parseYtDlpProgress(line);
                    if (p !== null) job.progress = p;
                }
            }
            const code = await proc.exited;
            if (job.status === 'cancelled') {
            } else if (code === 0) {
                job.status = 'completed';
                job.progress = 100;
            } else {
                job.status = 'failed';
                job.error = job.stderr.slice(-500) || `yt-dlp exit ${code}`;
            }
        } catch (e) {
            if (job.status !== 'cancelled') {
                job.status = 'failed';
                job.error = e instanceof Error ? e.message : String(e);
            }
        }
        job.resolveDone(toPublic(job));
    })();

    return toPublic(job);
}

export function getTrimExport(id: string): TrimExportJob | undefined {
    const job = jobs.get(id);
    return job ? toPublic(job) : undefined;
}

export function cancelTrimExport(id: string): boolean {
    const job = jobs.get(id);
    if (!job || job.status !== 'running') return false;
    job.status = 'cancelled';
    try { job.proc.kill(); } catch { }
    // File setengah jadi sengaja tidak dihapus manual di sini,
    // karena args sudah pakai --force-overwrites + --no-continue,
    // jadi export berikutnya dengan outputPath yang sama akan menimpa.
    job.resolveDone(toPublic(job));
    return true;
}

export function waitTrimExport(id: string): Promise<TrimExportJob> {
    const job = jobs.get(id);
    if (!job) throw new Error(`export ${id} tidak ditemukan`);
    return job.done;
}
