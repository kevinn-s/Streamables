/**
 * youtube-resolver.ts — Bun / Electrobun version
 *
 * TypeScript port of the yt-dlp resolution flow in Kdenlive's YouTube app
 * (`src/apps/builtin/youtubedownloader/youtubebackend.cpp`).
 *
 * Ported functions:
 *   - `YoutubeBackend::resolve(id)`       -> `YoutubeResolver.resolve(videoId)`
 *   - `YoutubeBackend::formatSelection()` -> `formatSelection()`
 *   - `YoutubeBackend::run(arguments)`    -> the `Bun.spawn()` part of `resolve()`
 *   - `YoutubeBackend::sources(data)`     -> `parseSources(data)`
 *   - `YoutubeBackend::cancel()`          -> `YoutubeResolver.cancel()`
 *   - anonymous `videoId()` helper        -> `isValidVideoId()`
 *   - anonymous `mediaUrl()` helper       -> `isMediaUrl()`
 *
 * The flow deliberately starts at `videoId` / `watchId`, exactly as
 * requested: obtaining that id is the caller's responsibility. This module
 * only validates the id, builds `https://www.youtube.com/watch?v=<id>`,
 * asks yt-dlp to resolve it, and turns yt-dlp's JSON into playable streams.
 *
 * Runtime: Bun ONLY. There are no `node:` imports, no `Buffer`, and no
 * `@types/node` here. This file must run in the Electrobun MAIN process
 * (the Bun side), not in a webview/renderer: a Chromium view cannot spawn
 * processes, so `Bun.spawn` does not exist there. The view should ask the
 * main process for streams over Electrobun RPC, and the main process calls
 * this module.
 *
 * For type-checking, use Bun's own types (`bun-types`, as included in a
 * typical Electrobun/Bun project) — not `@types/node`.
 *
 * Usage (main process):
 * ```ts
 * import { resolveYoutubeVideo } from "./youtube-resolver.ts";
 *
 * const streams = await resolveYoutubeVideo("dQw4w9WgXcQ");
 * // streams[0].url         -> HLS (.m3u8) playlist or direct media URL
 * // streams[0].audioUrl    -> separate audio URL, if video/audio are split
 * // streams[0].headers     -> headers the player must send with the URL
 * console.log(streams[0].label); // e.g. "HLS (.m3u8) — 720p"
 * ```
 */

import Electrobun from "electrobun";

/** One playable source, as produced by `parseSources()`. At most one. */
export interface YoutubeStream {
  /** Resolved video URL. For HLS this is the `.m3u8` playlist URL. */
  url: string;
  /** HTTP headers that must accompany requests for `url` (signed URLs). */
  headers: Record<string, string>;
  /** `"hls"` when the protocol starts with `m3u8`, otherwise `"direct"`. */
  format: "hls" | "direct";
  /** Video height in pixels, or 0 when yt-dlp did not report one. */
  height: number;
  /** Separate audio URL, only when yt-dlp returned split video/audio. */
  audioUrl?: string;
  /** HTTP headers that must accompany requests for `audioUrl`. */
  audioHeaders?: Record<string, string>;
  /** Human-readable label, e.g. `"HLS (.m3u8) — 720p"`. */
  label: string;
}

export interface ResolveOptions {
  /** Path/name of the yt-dlp executable. Defaults to `"yt-dlp"` (PATH). */
  ytDlpPath?: string;
  /** Overall timeout in ms. Defaults to 90_000, as in the C++ backend. */
  timeoutMs?: number;
  /** Optional abort signal; aborting kills yt-dlp and rejects the promise. */
  signal?: AbortSignal;
  /**
   * Optional yt-dlp JS runtime, e.g. `"deno"`, passed as
   * `--js-runtimes <runtime>`. Defaults to unset, so yt-dlp auto-detects
   * whatever JS runtime is available.
   *
   * Do NOT hardcode `"node"` here: this project runs on Bun and the user
   * has no Node.js installed, so forcing `node` would make yt-dlp fail on
   * a machine where node is absent. (The previous Node version of this
   * file did exactly that, because it only added the flag when node was
   * found in PATH — that check makes no sense on a Bun-only machine.)
   * Only set this if you know your yt-dlp build needs a specific runtime.
   */
  jsRuntime?: string;
}

/** A single format entry inside yt-dlp's `--dump-single-json` output. */
interface YtDlpFormat {
  url?: unknown;
  protocol?: unknown;
  height?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  http_headers?: unknown;
}

/** The subset of yt-dlp's JSON that `parseSources()` actually reads. */
interface YtDlpJson {
  duration?: unknown;
  is_live?: unknown;
  http_headers?: unknown;
  requested_formats?: unknown;
  // When there is no `requested_formats`, the top-level object is itself
  // the single (combined) format, so it may also carry these fields.
  url?: unknown;
  protocol?: unknown;
  height?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024; // 16 MiB, as in the C++ backend
const DEFAULT_TIMEOUT_MS = 90_000;

const EXTRACTION_FAILED =
  "YouTube extraction failed. Check your connection and update yt-dlp and its JavaScript support. The video may require sign-in or be unavailable.";

/**
 * Port of the anonymous `videoId()` helper.
 * A YouTube video id is exactly 11 chars of `[A-Za-z0-9_-]`.
 * A full `https://.../watch?v=...` URL is NOT accepted here on purpose:
 * the caller supplies the id, and `buildWatchUrl()` rebuilds the URL.
 */
export function isValidVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

/** Port of the anonymous `mediaUrl()` helper: only valid https URLs. */
export function isMediaUrl(text: unknown): text is string {
  if (typeof text !== "string") return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

/** Build the `?watch` URL from an already-validated id. */
export function buildWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Port of `YoutubeBackend::formatSelection()`.
 * This is yt-dlp's format selector, not a post-hoc ranking: yt-dlp itself
 * picks the first alternative that exists. `/` = fallback, `+` = merge
 * separate video and audio. Preference order:
 *  1. combined HLS with audio, height <= 1080
 *  2. separate HLS video + HLS audio, height <= 1080
 *  3. separate HLS video + any audio, height <= 1080
 *  4. separate video + audio, height <= 1080
 *  5. best combined format, height <= 1080
 *  6. best format, any height
 */
export function formatSelection(): string {
  return [
    "best[protocol^=m3u8][height<=1080]",
    "bestvideo[protocol^=m3u8][height<=1080]+bestaudio[protocol^=m3u8]",
    "bestvideo[protocol^=m3u8][height<=1080]+bestaudio",
    "bestvideo[height<=1080]+bestaudio",
    "best[height<=1080]",
    "best",
  ].join("/");
}

/** Keep only string-valued header entries, as the C++ QVariantMap does. */
function stringHeaders(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Concatenate Uint8Array chunks without Buffer (Bun-native, no Node). */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Port of `YoutubeBackend::sources(data)`.
 *
 * Returns `[]` when there is nothing playable, otherwise exactly one
 * stream. The empty cases mirror the C++ code:
 *  - duration is missing, not finite, or <= 0
 *  - the video is live (`is_live`)
 *  - no format has a video codec
 *  - there are several formats but no separate audio format
 *
 * Note on codecs: an HLS audio rendition may report `acodec: null`
 * (unknown until opened). Like the C++ code, `null` counts as "has audio"
 * here because it is not literally `"none"`.
 */
export function parseSources(data: unknown): YoutubeStream[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [];
  }
  const root = data as YtDlpJson;

  const duration =
    typeof root.duration === "number" ? root.duration : Number.NaN;
  if (!Number.isFinite(duration) || duration <= 0 || root.is_live === true) {
    return [];
  }

  const formats: YtDlpFormat[] = Array.isArray(root.requested_formats) &&
    root.requested_formats.length > 0
    ? (root.requested_formats as YtDlpFormat[])
    : [root as YtDlpFormat];

  const globalHeaders = stringHeaders(root.http_headers);
  let source: YoutubeStream | undefined;
  let audio: Pick<YoutubeStream, "url" | "headers"> | undefined;

  for (const format of formats) {
    if (typeof format !== "object" || format === null) continue;
    if (!isMediaUrl(format.url)) continue;

    // Per-format headers override the top-level headers.
    const headers = { ...globalHeaders, ...stringHeaders(format.http_headers) };
    const hls =
      typeof format.protocol === "string" && format.protocol.startsWith("m3u8");
    const height =
      typeof format.height === "number" && Number.isFinite(format.height)
        ? Math.trunc(format.height)
        : 0;
    const stream: YoutubeStream = {
      url: format.url,
      headers,
      format: hls ? "hls" : "direct",
      height,
      label: "", // filled in below, once the winning stream is known
    };

    const vcodec = typeof format.vcodec === "string" ? format.vcodec : "none";
    if (vcodec !== "none") {
      source = stream;
    } else if (typeof format.acodec !== "string" || format.acodec !== "none") {
      // vcodec is "none" here; acodec "none" means neither, anything else
      // (including null) is an audio-only format.
      audio = stream;
    }
  }

  if (!source || (formats.length > 1 && !audio)) return [];

  if (audio) {
    source.audioUrl = audio.url;
    source.audioHeaders = audio.headers;
  }

  const baseLabel = source.format === "hls" ? "HLS (.m3u8)" : "Direct stream";
  source.label =
    source.height > 0 ? `${baseLabel} — ${source.height}p` : baseLabel;
  return [source];
}

/**
 * Stateful resolver, mirroring the C++ `YoutubeBackend` instance.
 * One instance owns one cancellable resolution at a time: starting a new
 * `resolve()` cancels (and rejects) any previous one still in flight,
 * exactly like `run()` calling `cancel()` first in the C++ code.
 */
export class YoutubeResolver {
  private current: ReturnType<typeof Bun.spawn> | null = null;
  private currentReject: ((error: Error) => void) | null = null;
  // Cleanup for the in-flight run (timer, abort listener, stdout reader).
  // Needed so `cancel()` also releases these: otherwise a cancelled run's
  // 90-second timer alone would keep Bun's event loop alive for 90s,
  // even though its promise already rejected.
  private currentCleanup: (() => void) | null = null;
  private generation = 0;

  /**
   * Resolve a video id to its playable stream(s).
   * This is the entry point that replaces `YoutubeBackend::resolve()`:
   * it validates the id, builds the `?watch` URL, and runs yt-dlp.
   * It rejects (never returns a partial result) on invalid id, missing
   * yt-dlp, timeout, oversized output, failed extraction, or no
   * playable finite-duration stream.
   */
  resolve(
    videoId: string,
    options: ResolveOptions = {},
  ): Promise<YoutubeStream[]> {
    if (!isValidVideoId(videoId)) {
      // The C++ code silently returns here; a Promise API has to say
      // something, so this is surfaced as a rejection instead.
      return Promise.reject(
        new Error(
          `Invalid YouTube video id: expected 11 characters [A-Za-z0-9_-], got ${JSON.stringify(videoId)}`,
        ),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(new Error("YouTube resolution was aborted."));
    }

    this.cancel();
    const generation = ++this.generation;
    const executable = options.ytDlpPath ?? "yt-dlp";
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<YoutubeStream[]>((resolvePromise, rejectPromise) => {
      const args = [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-warnings",
        "--skip-download", // metadata only: never download the video file
        "--dump-single-json",
        "--socket-timeout",
        "15",
        "--retries",
        "1",
        // No `--js-runtimes node` here on purpose: see `jsRuntime` above.
        ...(options.jsRuntime
          ? ["--js-runtimes", options.jsRuntime]
          : []),
        "--no-playlist",
        "-f",
        formatSelection(),
        "--",
        buildWatchUrl(videoId),
      ];

      let proc: ReturnType<typeof Bun.spawn>;
      try {
        // stderr is discarded so signed media URLs never enter logs,
        // mirroring `setStandardErrorFile(QProcess::nullDevice())`.
        // Bun.spawn throws synchronously when the executable is missing
        // (code ENOENT), unlike Node's async `error` event.
        proc = Bun.spawn([executable, ...args], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        console.log("error nih = ",error)
        rejectPromise(
          code === "ENOENT"
            ? new Error(
                "Install yt-dlp with yt-dlp-ejs and a supported JavaScript runtime (Deno or Node) to browse YouTube.",
              )
            : new Error("Could not start yt-dlp."),
        );
        return;
      }
      this.current = proc;
      this.currentReject = rejectPromise;

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let settled = false;
      // Set once the stdout reader exists, so cleanup can release it.
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if (this.current === proc) {
          this.current = null;
          this.currentReject = null;
        }
        if (this.currentCleanup === cleanup) this.currentCleanup = null;
        // Release the stdout reader on settle. Without this, a killed
        // process whose stdout pipe is still held open by one of its own
        // children would keep the reader (and Bun's event loop) waiting
        // indefinitely, even though the promise already rejected.
        if (reader) {
          const toCancel = reader;
          reader = null;
          void toCancel.cancel().catch(() => {});
        }
      };
      this.currentCleanup = cleanup;
      // Reject only if this run is still the current one; a newer
      // resolve()/cancel() must not overwrite the newer run's outcome.
      const fail = (error: Error) => {
        if (settled || this.generation !== generation) return;
        settled = true;
        cleanup();
        rejectPromise(error);
      };
      const succeed = (streams: YoutubeStream[]) => {
        if (settled || this.generation !== generation) return;
        settled = true;
        cleanup();
        resolvePromise(streams);
      };
      const kill = () => {
        // SIGKILL (9): unlike SIGTERM it cannot be deferred by a shell
        // wrapper waiting on a child, matching the Node version's kill.
        if (!proc.killed) proc.kill(9);
      };
      const onAbort = () => {
        kill();
        fail(new Error("YouTube resolution was aborted."));
      };

      const timer = setTimeout(() => {
        kill();
        fail(new Error("YouTube timed out. Please retry."));
      }, timeoutMs);
      options.signal?.addEventListener("abort", onAbort, { once: true });

      const stdout = proc.stdout;
      if (!(stdout instanceof ReadableStream)) {
        fail(new Error("Could not start yt-dlp."));
        return;
      }

      // Drain stdout in the background; `proc.exited` alone does not
      // guarantee every byte has been read yet.
      reader = stdout.getReader();
      const activeReader = reader;
      const readDone = (async () => {
        try {
          for (;;) {
            const { done, value } = await activeReader.read();
            if (done) return;
            if (!value) continue;
            totalBytes += value.length;
            if (totalBytes > MAX_OUTPUT_BYTES) {
              kill();
              fail(new Error("YouTube returned too much data."));
              return;
            }
            chunks.push(value);
          }
        } catch {
          // A killed process closes its stdout; the exit-code check below
          // (or the already-settled failure) decides the outcome.
        }
      })();

      void (async () => {
        const code = await proc.exited;
        await readDone;
        if (settled || this.generation !== generation) return;
        if (code !== 0) {
          fail(new Error(EXTRACTION_FAILED));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            new TextDecoder().decode(concatBytes(chunks)),
          );
        } catch {
          fail(new Error(EXTRACTION_FAILED));
          return;
        }
        const streams = parseSources(parsed);
        if (streams.length === 0) {
          fail(
            new Error(
              "No playable video with a finite duration was found. Live streams are not supported.",
            ),
          );
          return;
        }
        succeed(streams);
      })();
    });
  }

  /**
   * Port of `YoutubeBackend::cancel()`: kills the in-flight yt-dlp
   * process and rejects its promise. Safe to call when nothing is running.
   */
  cancel(): void {
    const proc = this.current;
    const rejectPromise = this.currentReject;
    const cleanup = this.currentCleanup;
    this.generation += 1;
    this.current = null;
    this.currentReject = null;
    this.currentCleanup = null;
    if (proc && !proc.killed) proc.kill(9);
    // Release the run's timer/abort listener/reader too (see the field
    // comment above); rejecting alone would leave them pending.
    cleanup?.();
    rejectPromise?.(new Error("YouTube resolution was cancelled."));
  }
}

/**
 * One-shot convenience wrapper, for callers that don't need cancellation
 * or reuse of a resolver instance.
 */
export function resolveYoutubeVideo(
  videoId: string,
  options: ResolveOptions = {},
): Promise<YoutubeStream[]> {
  return new YoutubeResolver().resolve(videoId, options);
}
