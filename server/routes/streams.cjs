"use strict";

const http = require("node:http");
const https = require("node:https");
const { json, fail, readJson, assertSafePublicUrl } = require("../lib/http.cjs");
const { run, resolveYtDlp, friendlyYtDlpError } = require("../lib/proc.cjs");
const { isPlaylist, rewritePlaylist } = require("../lib/hls.cjs");
const { pickPlayable, startPrepare, detectDirectMedia } = require("../services/media.cjs");

const SEGMENT_CACHE = new Map(); // url -> { body, type }
const SEGMENT_LIMIT = 64;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
let cacheBytes = 0;

function cacheGet(key) {
  const entry = SEGMENT_CACHE.get(key);
  if (!entry) return null;
  // Promote to MRU so hot HLS segments stay cached.
  SEGMENT_CACHE.delete(key);
  SEGMENT_CACHE.set(key, entry);
  return entry;
}

function cacheSet(key, body, type) {
  if (body.length > MAX_ENTRY_BYTES) return;
  const existing = SEGMENT_CACHE.get(key);
  if (existing) {
    cacheBytes -= existing.body.length;
    SEGMENT_CACHE.delete(key);
  }
  while (SEGMENT_CACHE.size >= SEGMENT_LIMIT || cacheBytes + body.length > MAX_CACHE_BYTES) {
    const oldestKey = SEGMENT_CACHE.keys().next().value;
    if (!oldestKey) break;
    const oldest = SEGMENT_CACHE.get(oldestKey);
    cacheBytes -= oldest.body.length;
    SEGMENT_CACHE.delete(oldestKey);
  }
  SEGMENT_CACHE.set(key, { body, type });
  cacheBytes += body.length;
}

function proxyFetch(target, headers) {
  return new Promise((resolve, reject) => {
    const lib = target.protocol === "https:" ? https : http;
    const request = lib.get(target, { headers }, (response) => resolve(response));
    request.on("error", reject);
    request.setTimeout(30000, () => request.destroy(new Error("Upstream timed out")));
  });
}

async function apiStream(req, res, query) {
  const raw = query.get("url") || "";
  let target;
  try {
    target = await assertSafePublicUrl(raw);
  } catch (e) {
    return fail(res, 400, e.message || "Bad stream URL");
  }

  if (!req.headers.range) {
    const cached = cacheGet(target.href);
    if (cached) {
      res.statusCode = 200;
      res.setHeader("Content-Type", cached.type);
      res.setHeader("Content-Length", cached.body.length);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      res.end(cached.body);
      return;
    }
  }

  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers["user-agent"]) headers["User-Agent"] = req.headers["user-agent"];
  let upstream;
  try {
    upstream = await proxyFetch(target, headers);
  } catch (e) {
    return fail(res, 502, `Couldn't reach that stream: ${e.message}`);
  }
  res.on("close", () => {
    if (!upstream.destroyed) upstream.destroy();
  });

  const status = upstream.statusCode || 200;
  const type = upstream.headers["content-type"] || "application/octet-stream";
  const playlist = status >= 200 && status < 300 && isPlaylist(type, target.href);

  if (playlist) {
    const chunks = [];
    let size = 0;
    for await (const c of upstream) {
      size += c.length;
      if (size > MAX_ENTRY_BYTES) {
        upstream.destroy();
        return fail(res, 502, "Playlist too large");
      }
      chunks.push(c);
    }
    const rewritten = rewritePlaylist(Buffer.concat(chunks).toString("utf8"), target);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.end(rewritten);
    return;
  }

  // Forward upstream headers and stream immediately so files > 8MB are never truncated.
  res.statusCode = status;
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    if (upstream.headers[key]) res.setHeader(key, upstream.headers[key]);
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const shouldCache = !req.headers.range && status === 200;
  const teeChunks = shouldCache ? [] : null;
  let teeSize = 0;
  let cacheAborted = false;

  upstream.on("data", (chunk) => {
    if (teeChunks && !cacheAborted) {
      teeSize += chunk.length;
      if (teeSize <= MAX_ENTRY_BYTES) teeChunks.push(chunk);
      else {
        cacheAborted = true;
        teeChunks.length = 0;
      }
    }
    if (!res.write(chunk)) upstream.pause();
  });
  res.on("drain", () => upstream.resume());
  upstream.on("end", () => {
    if (teeChunks && !cacheAborted && teeChunks.length) {
      cacheSet(target.href, Buffer.concat(teeChunks), type);
    }
    res.end();
  });
  upstream.on("error", () => {
    if (!res.headersSent) fail(res, 502, "Stream interrupted");
    else res.destroy();
  });
}

function titleFromDirectUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const part = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return decodeURIComponent(part).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 60) || u.hostname;
  } catch {
    return "Stream";
  }
}

async function apiResolve(req, res) {
  const { url } = await readJson(req);
  try {
    await assertSafePublicUrl(url);
  } catch (e) {
    return fail(res, 400, e.message || "Paste an http(s) link.");
  }

  const direct = await detectDirectMedia(String(url));
  if (direct.direct) {
    return json(res, 200, {
      url: `/stream?url=${encodeURIComponent(String(url))}`,
      originalUrl: String(url),
      title: titleFromDirectUrl(String(url)),
      platform: "url",
      live: direct.kind === "hls",
      kind: direct.kind,
    });
  }

  const ytDlp = await resolveYtDlp();
  if (!ytDlp) {
    return fail(
      res,
      422,
      "yt-dlp is not available in this cloud container, so YouTube/Twitch/Kick page links can't be extracted server-side. Use Capture Tab in the Viewer to capture any playing tab, paste a direct .m3u8/.mp4 stream URL, or upload a local video in Clips.",
    );
  }

  const r = await run(ytDlp, ["-J", "--no-warnings", "--no-playlist", String(url)], { timeout: 90000 });
  if (r.code !== 0) {
    const msg = friendlyYtDlpError(r.stderr);
    return fail(res, /blocked server-side extraction/i.test(msg) ? 422 : 502, msg);
  }
  let info;
  try {
    info = JSON.parse(r.stdout);
  } catch {
    return fail(res, 502, "yt-dlp returned something unreadable.");
  }
  if (Array.isArray(info.entries) && info.entries.length) info = info.entries[0];
  const platform = /youtube|youtu\.be/i.test(info.extractor || url) ? "youtube" : /twitch/i.test(info.extractor || "") ? "twitch" : /kick/i.test(info.extractor || "") ? "kick" : "url";

  // YouTube VODs carry video and audio in separate streams; prepare a merged MP4 instead.
  if (platform === "youtube" && !info.is_live) {
    const job = await startPrepare(String(url), info.title);
    return json(res, 200, {
      url: `/media?id=${job.id}&source=${encodeURIComponent(String(url))}`,
      originalUrl: String(url),
      title: info.title || "YouTube video",
      platform,
      live: false,
      kind: "video",
    });
  }

  const format = pickPlayable(info);
  if (!format) return fail(res, 502, "No playable video stream was found for that link.");
  json(res, 200, {
    url: `/stream?url=${encodeURIComponent(format.url)}`,
    originalUrl: String(url),
    title: info.title || String(url),
    platform,
    live: !!info.is_live,
    kind: /m3u8/i.test(format.protocol || format.url) ? "hls" : "video",
  });
}

module.exports = {
  "GET /stream": apiStream,
  "POST /api/resolve": apiResolve,
};
