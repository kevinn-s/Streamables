/// <reference types="bun" />
import { resolveYoutubeVideo } from "../src/mods/youtube.ts";

const PROXY_BASE = "http://127.0.0.1:4317/proxy";

function corsHeaders(contentType?: string | null) {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

function rewritePlaylist(text: string, baseUrl: string) {
  return text
    .split("\n")
    .map((line) => {
      if (!line) return line;
      if (line.startsWith("#")) {
        // Untuk baris seperti #EXT-X-KEY:URI="..." atau #EXT-X-MAP:URI="..."
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
          const abs = new URL(uri, baseUrl).toString();
          return `URI="${PROXY_BASE}?url=${encodeURIComponent(abs)}"`;
        });
      }
      // Baris segmen, relatif maupun absolut, ditulis ulang lewat proxy
      const abs = new URL(line, baseUrl).toString();
      return `${PROXY_BASE}?url=${encodeURIComponent(abs)}`;
    })
    .join("\n");
}

Bun.serve({
  hostname: "127.0.0.1",
  port: 4317,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/resolve") {
      const id = url.searchParams.get("id");
      if (!id) {
        return Response.json({ error: "missing id" }, { status: 400, headers: corsHeaders("application/json") });
      }
      try {
        const streams = await resolveYoutubeVideo(id);
        return Response.json(streams, { headers: corsHeaders("application/json") });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders("application/json") },
        );
      }
    }

    if (url.pathname === "/proxy") {
  const target = url.searchParams.get("url");
  if (!target) {
    return Response.json(
      { error: "missing url" },
      { status: 400, headers: corsHeaders("application/json") },
    );
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
    });
    const contentType = upstream.headers.get("content-type");

    if (!upstream.ok) {
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: corsHeaders(contentType),
      });
    }

    const isPlaylist = new URL(target).pathname.endsWith(".m3u8");
    if (isPlaylist) {
      const text = await upstream.text();
      return new Response(rewritePlaylist(text, target), {
        headers: corsHeaders(contentType),
      });
    }

    return new Response(upstream.body, { headers: corsHeaders(contentType) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: corsHeaders("application/json") },
    );
  }
}

    return new Response("not found", { status: 404, headers: corsHeaders() });
  },
});

console.log("resolver + proxy server: http://127.0.0.1:4317");
