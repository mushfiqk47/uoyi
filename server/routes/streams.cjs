"use strict";

const http = require("node:http");
const https = require("node:https");
const { json, fail, readJson } = require("../lib/http.cjs");
const { run, hasTool } = require("../lib/proc.cjs");
const { isPlaylist, rewritePlaylist } = require("../lib/hls.cjs");
const { validateExternalHttpUrl } = require("../lib/security.cjs");
const { pickPlayable, startPrepare, detectDirectMedia } = require("../services/media.cjs");

const SEGMENT_CACHE = new Map(); // url -> { body, type, bytes }
const SEGMENT_LIMIT = 64;
const SEGMENT_MAX_BYTES = 64 * 1024 * 1024;
let segmentCacheBytes = 0;

function cacheSegment(href, body, type) {
  const existing = SEGMENT_CACHE.get(href);
  if (existing) {
    segmentCacheBytes -= existing.bytes;
    SEGMENT_CACHE.delete(href);
  }
  const bytes = body.length;
  while ((SEGMENT_CACHE.size >= SEGMENT_LIMIT || segmentCacheBytes + bytes > SEGMENT_MAX_BYTES) && SEGMENT_CACHE.size > 0) {
    const oldestKey = SEGMENT_CACHE.keys().next().value;
    const oldest = SEGMENT_CACHE.get(oldestKey);
    if (oldest) segmentCacheBytes -= oldest.bytes;
    SEGMENT_CACHE.delete(oldestKey);
  }
  if (bytes <= SEGMENT_MAX_BYTES) {
    SEGMENT_CACHE.set(href, { body, type, bytes });
    segmentCacheBytes += bytes;
  }
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
  const check = await validateExternalHttpUrl(query.get("url") || "");
  if (!check.ok) return fail(res, 400, check.error || "Bad stream URL");
  const target = check.url;

  const cached = SEGMENT_CACHE.get(target.href);
  if (cached) {
    // Refresh LRU order
    SEGMENT_CACHE.delete(target.href);
    SEGMENT_CACHE.set(target.href, cached);
    res.statusCode = 200;
    res.setHeader("Content-Type", cached.type);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.end(cached.body);
    return;
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

  const type = upstream.headers["content-type"] || "application/octet-stream";
  const playlist = isPlaylist(type, target.href);

  if (playlist) {
    const chunks = [];
    for await (const c of upstream) chunks.push(c);
    const rewritten = rewritePlaylist(Buffer.concat(chunks).toString("utf8"), target);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.end(rewritten);
    return;
  }

  if (!req.headers.range) {
    const chunks = [];
    let size = 0;
    for await (const c of upstream) {
      size += c.length;
      if (size > 8 * 1024 * 1024) break;
      chunks.push(c);
    }
    if (size <= 8 * 1024 * 1024) {
      const body = Buffer.concat(chunks);
      cacheSegment(target.href, body, type);
      res.statusCode = 200;
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Length", body.length);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      res.end(body);
      return;
    }
  }

  res.statusCode = upstream.statusCode || 200;
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    if (upstream.headers[key]) res.setHeader(key, upstream.headers[key]);
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  upstream.pipe(res);
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
  const check = await validateExternalHttpUrl(url);
  if (!check.ok) return fail(res, 400, check.error || "Paste a public http(s) link.");

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

  const ytDlpAvailable = await hasTool("yt-dlp", ["--version"]);
  if (!ytDlpAvailable) {
    return fail(
      res,
      422,
      "yt-dlp is not installed in this cloud container, so YouTube/Twitch/Kick page links can't be extracted server-side. Use Capture Tab in the Viewer to capture any playing tab, paste a direct .m3u8/.mp4 stream URL, or upload a local video in Clips.",
    );
  }

  const r = await run("yt-dlp", ["-J", "--no-warnings", "--no-playlist", String(url)], { timeout: 90000 });
  if (r.code !== 0) {
    return fail(res, 502, r.stderr.split("\n").filter(Boolean).slice(-1)[0] || "yt-dlp couldn't resolve that link.");
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
