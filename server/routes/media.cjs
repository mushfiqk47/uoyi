"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { json, fail, readJson, sendFile, assertSafePublicUrl } = require("../lib/http.cjs");
const { probe } = require("../lib/proc.cjs");
const { ensureCache, mediaFile } = require("../lib/files.cjs");
const { id } = require("../lib/id.cjs");
const { startPrepare } = require("../services/media.cjs");
const { mediaJobs, clipFiles } = require("../state.cjs");

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB safety cap

async function apiMediaPrepare(req, res) {
  const { url } = await readJson(req);
  try {
    await assertSafePublicUrl(url);
  } catch (e) {
    return fail(res, 400, e.message || "Paste an http(s) link.");
  }
  const job = await startPrepare(String(url), String(url));
  json(res, 200, { id: job.id, url: `/media?id=${job.id}` });
}

async function apiMediaStatus(_req, res, query) {
  const job = mediaJobs.get(query.get("id") || "");
  if (!job) return json(res, 200, { id: query.get("id"), status: "unknown", err: "Unknown media job" });
  json(res, 200, { id: job.id, status: job.status, err: job.err, title: job.title });
}

async function serveMedia(req, res, query) {
  const job = mediaJobs.get(query.get("id") || "");
  if (!job) return fail(res, 404, "Unknown media");
  // Hold the request until preparation settles, but bail immediately if the client disconnects.
  const deadline = Date.now() + 180000;
  while (job.status === "preparing" && Date.now() < deadline && !req.destroyed && !res.destroyed) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (req.destroyed || res.destroyed) return;
  if (job.status === "failed") return fail(res, 409, job.err || "Media preparation failed");
  if (job.status !== "ready") return fail(res, 504, "Media is still preparing");
  try {
    await sendFile(req, res, job.file, "video/mp4");
  } catch {
    if (!res.headersSent) fail(res, 404, "Media file not found");
  }
}

async function serveClip(req, res, query) {
  const clip = clipFiles.get(query.get("id") || "");
  if (!clip) return fail(res, 404, "Unknown clip");
  try {
    await sendFile(req, res, clip.file, clip.mime || "video/mp4");
  } catch {
    if (!res.headersSent) fail(res, 404, "Clip file not found");
  }
}

async function apiUpload(req, res, query) {
  const name = query.get("name") || "upload.mp4";
  const mediaId = id();
  const ext = path.extname(name).replace(/[^.a-z0-9]/gi, "") || ".mp4";
  const file = mediaFile(mediaId, ext.slice(1));
  await ensureCache();
  const sink = fs.createWriteStream(file);
  let total = 0;
  let completed = false;
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        return fail(res, 413, "Uploaded file exceeds 2 GiB limit.");
      }
      if (!sink.write(chunk)) await new Promise((r) => sink.once("drain", r));
    }
    completed = true;
  } finally {
    await new Promise((r) => sink.end(r));
    if (!completed) await fsp.rm(file, { force: true }).catch(() => {});
  }
  const info = await probe(file);
  if (!info.hasVideo && !info.hasAudio) {
    await fsp.rm(file, { force: true }).catch(() => {});
    return fail(res, 415, "That file isn't readable media.");
  }
  mediaJobs.set(mediaId, { id: mediaId, status: "ready", file, err: "", title: path.basename(name, ext), url: "" });
  json(res, 200, { id: mediaId, title: path.basename(name, ext) });
}

module.exports = {
  "POST /api/media/prepare": apiMediaPrepare,
  "GET /api/media/status": apiMediaStatus,
  "GET /media": serveMedia,
  "GET /media/clip": serveClip,
  "POST /api/upload": apiUpload,
};
