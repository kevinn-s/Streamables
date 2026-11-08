export const RESOLVE_BRIDGE_HOST = "127.0.0.1";
export const RESOLVE_BRIDGE_PORT = 56003;
export const RESOLVE_BRIDGE_URL = `http://${RESOLVE_BRIDGE_HOST}:${RESOLVE_BRIDGE_PORT}`;

const RESOLVE_OFFLINE_MESSAGE: string =
    "DaVinci Resolve is not running or the Streamables bridge is unavailable. \
   Open DaVinci Resolve and run Workspace → Scripts → Streamables \
   (once per Resolve session).";

type TimelineInfo = {
    name: string;
    startFrame: number;
    endFrame: number;
    frameRate: number | null;
    durationSeconds: number | null;
    isCurrent: boolean;
};

type CurrentProjectInfo = {
    name: string;
    timelineCount: number;
    currentTimelineName: string | null;
    frameRate: number | null;
    timelines: TimelineInfo[];
};

type VideoTrackInfo = {
    index: number; // 1-based, seperti di Resolve: V1 = 1
    clipCount: number;
};

type TracksResult = {
    timelineName: string;
    videoTrackCount: number;
    tracks: VideoTrackInfo[]; // length === videoTrackCount, video only
};

const invokesInFlight = new Map<string, { path: string; startDate: string; startTime: string; }>();

function randomId(): string {
    // FIX: window.crypto tidak ada di Bun main process, pakai globalThis.
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function beginInvoke(path: string): string {
    const id = randomId(), currentDate = new Date();
    invokesInFlight.set(id, {
        path,
        startDate: new Intl.DateTimeFormat('en-CA').format(currentDate),
        startTime: new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(currentDate)
    });
    return id;
}

function isOfflineError(err: unknown): boolean {
    if (err instanceof TypeError) return true;
    if (err instanceof Error) return /ECONNREFUSED|fetch failed|Failed to fetch/i.test(err.message);
    return false;
}

/** invoking a specific Resolve script function via rpc bridge */
export async function invokeResolveMethod(
    fun: string, // as in function
    params: Record<string, any> = {},
    timeout: number = 5000,
) {
    const id = beginInvoke("call");
    try {
        const res = await fetch(`${RESOLVE_BRIDGE_URL}/call`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // FIX: kunci body harus "func", bukan "fun", supaya server slice 1 membacanya.
            // Kalau server Python-mu membaca "fun", ganti "func" di bawah ini kembali ke "fun".
            body: JSON.stringify({ id: id, func: fun, params }),
            signal: AbortSignal.timeout(timeout),
        });

        const body = await res.json();
        if (!body.ok) throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error);
        if (body.id && body.id !== id) throw new Error(`Response id mismatch: ${body.id} != ${id}`);

        return body.result;
    } catch (err) {
        if (isOfflineError(err)) throw new Error(RESOLVE_OFFLINE_MESSAGE);
        if (err instanceof DOMException && err.name === "TimeoutError") {
            throw new Error(`Resolve bridge timeout after ${timeout}ms for ${fun}`);
        }
        throw err;
    } finally {
        invokesInFlight.delete(id);
    }
}

async function getCurrentProject(
    timeout: number = 5000
) {
    const id = beginInvoke("info/project");
    try {
        const res = await fetch(`${RESOLVE_BRIDGE_URL}/info/project`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: id }),
            signal: AbortSignal.timeout(timeout),
        });

        const body = await res.json();
        if (!body.ok) throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error);

        return body.result as CurrentProjectInfo;
    } catch (err) {
        if (isOfflineError(err)) throw new Error(RESOLVE_OFFLINE_MESSAGE);
        throw err;
    } finally {
        invokesInFlight.delete(id);
    }
}

function getSelectedTimeline(
    project: CurrentProjectInfo,
    timelineName: string
): TimelineInfo {
    const found = project.timelines.find(t => t.name === timelineName);
    if (!found) throw new Error(`Timeline not found: ${timelineName}`);
    return found;
}

async function getCurrentTracks(
    projectName: string,
    timelineName: string,
    timeout: number = 5000
) {
    const id = beginInvoke("info/tracks");
    try {
        const res = await fetch(`${RESOLVE_BRIDGE_URL}/info/tracks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Server harus memakai "timeline" ini untuk men-scope track,
            // kalau tidak, pilihan timeline di UI tidak akan berpengaruh.
            body: JSON.stringify({ id: id, project: projectName, timeline: timelineName }),
            signal: AbortSignal.timeout(timeout),
        });

        const body = await res.json();
        if (!body.ok) throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error);

        const result = body.result as TracksResult;
        if (result.tracks.length !== result.videoTrackCount) {
            throw new Error(`Tracks length mismatch: ${result.tracks.length} != ${result.videoTrackCount}`);
        }
        return result;
    } catch (err) {
        if (isOfflineError(err)) throw new Error(RESOLVE_OFFLINE_MESSAGE);
        throw err;
    } finally {
        invokesInFlight.delete(id);
    }
}

// Contoh pemakaian yang benar:
// const project = await getCurrentProject();
// const selected = getSelectedTimeline(project, project.currentTimelineName ?? project.timelines[0].name);
// const tracks = await getCurrentTracks(project.name, selected.name);
// const result = await invokeResolveMethod("ImportClipToTrack", { filePath, trackIndex: 1 }, 15000);
