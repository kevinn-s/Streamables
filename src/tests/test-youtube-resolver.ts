/**
 * test-youtube-resolver.ts — throwaway runner for the yt-dlp resolver.
 *
 * Project layout this file assumes:
 *   {project}/
 *     src/
 *       mods/
 *         youtube.ts              <- the resolver (youtube-resolver.ts,
 *                                    renamed to youtube.ts in your project)
 *       tests/
 *         test-youtube-resolver.ts  <- this file
 *
 * Run this directly with Bun, WITHOUT starting the Electrobun app, from
 * the project root:
 *
 *   bun src/tests/test-youtube-resolver.ts dQw4w9WgXcQ
 *
 * The import below is relative to THIS file, not to where you run bun
 * from: from src/tests/, one level up (..) lands in src/, then down
 * into mods/youtube.ts. That is why it is "../mods/youtube.ts" and not
 * "./youtube-resolver.ts".
 *
 * Requirements, same as the real app:
 *  - Bun (this is Bun code, not Node)
 *  - `yt-dlp` on PATH, with a JS runtime yt-dlp can use for YouTube
 *    extraction (yt-dlp-ejs). If yt-dlp needs a specific runtime on your
 *    machine, pass it via the `jsRuntime` option below, e.g. "deno".
 */

import { resolveYoutubeVideo } from "../mods/youtube.ts";

const videoId = Bun.argv[2];

if (!videoId) {
  console.error("Usage: bun src/tests/test-youtube-resolver.ts <videoId>");
  console.error("Example: bun src/tests/test-youtube-resolver.ts dQw4w9WgXcQ");
  process.exit(1);
}

try {
  const streams = await resolveYoutubeVideo(videoId, {
    // Uncomment and adjust only if yt-dlp on your machine needs a
    // specific JS runtime, e.g. jsRuntime: "deno",
  });
  console.log(JSON.stringify(streams, null, 2));
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
