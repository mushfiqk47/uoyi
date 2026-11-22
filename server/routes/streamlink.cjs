"use strict";

// Server-side live recording via Streamlink (https://github.com/streamlink/streamlink).
// Streamlink reads the stream straight from the source (Twitch/YouTube/Kick HLS) at the live
// edge and writes it to disk untouched — no browser decode/re-encode, so the recording has the
// source's own quality and zero dropped or duplicated frames, and it keeps recording while the
// viewer tab is hidden or closed.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { json, fail, readJson } = require("../lib/http.cjs");
const { findStreamlink, run, probe } = require("../lib/proc.cjs");
const { ensureCache, mediaFile } = require("../lib/files.cjs");
const { validateExternalHttpUrl } = require("../lib/security.cjs");
const { id } = require("../lib/id.cjs");
const { mediaJobs } = require("../state.cjs");

/** jobId -> { id, child, done, file, title, url, quality, startedAt, status, err, killed } */
const recs = new Map();
const MAX_CONCURRENT_RECORDS = 6;

function streamlinkQualityArg(quality) {
  return quality === "smooth" ? "720p60,720p,best" : "best";
}

function runChild(cmd, args, rec) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      rec.status = "failed";
      rec.err = String(e.message || e);
      return resolve({ code: -1, stdout: "", stderr: rec.err });
    }
    rec.child = child;
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += String(d); if (stderr.length > 2e5) stderr = stderr.slice(-1e5); });
    child.on("error", (e) => {
      if (rec.status === "recording") {
        rec.status = "failed";
        rec.err = String(e.message || e);
      }
      resolve({ code: -1, stdout: "", stderr: String(e.message || e) });
    });
    child.on("close", (code) => {
      if (rec.status !== "recording") return resolve({ code: code ?? -1, stdout: "", stderr });
      if (code === 0 || rec.killed) {
        rec.status = "done";
      } else {
        rec.status = "failed";
        rec.err = stderr.split("\n").filter(Boolean).slice(-1)[0] || `Streamlink exited with code ${code}`;
      }
      resolve({ code: code ?? -1, stdout: "", stderr });
    });
  });
}

function spawnStreamlink(rec) {
  rec.done = findStreamlink().then(async (tool) => {
    if (!tool) {
      rec.status = "failed";
      rec.err = "Streamlink is not installed. Install it with: pip install streamlink";
      return { code: -1, stderr: rec.err, stdout: "" };
    }
    const core = [...tool.prefix, "--loglevel", "warning", rec.url, streamlinkQualityArg(rec.quality), "-o", rec.file];
    let result = await runChild(tool.cmd, [...core, "--retry-streams", "3", "--retry-max", "5", "--twitch-low-latency"], rec);
    if (rec.status === "failed" && /unrecognized arguments|unknown option/i.test(result.stderr)) {
      rec.status = "recording";
      rec.err = "";
      rec.child = null;
      result = await runChild(tool.cmd, core, rec);
    }
    return result;
  });
  return rec.done;
}

/** Losslessly remuxes MPEG-TS to faststart MP4 without re-encoding video/audio. */
async function remuxTsToMp4(tsFile, mp4File) {
  const candidates = [
    ["-y", "-hide_banner", "-loglevel", "error", "-i", tsFile, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", mp4File],
    ["-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-i", tsFile, "-c", "copy", "-movflags", "+faststart", mp4File],
  ];
  for (const args of candidates) {
    const r = await run("ffmpeg", args, { timeout: 120000 });
    const size = await fsp.stat(mp4File).then((s) => s.size).catch(() => 0);
    if (r.code === 0 && size > 0 && fs.existsSync(mp4File)) {
      return true;
    }
    await fsp.rm(mp4File, { force: true }).catch(() => {});
  }
  return false;
}

async function apiStreamlinkRecord(req, res) {
  const { url, title, quality } = await readJson(req);
  const check = await validateExternalHttpUrl(url);
  if (!check.ok) return fail(res, 400, check.error || "Paste an http(s) stream link (Twitch, YouTube, Kick, or a direct .m3u8).");
  const active = [...recs.values()].filter((r) => r.status === "recording");
  if (active.length >= MAX_CONCURRENT_RECORDS) return fail(res, 429, `Too many server recordings at once (max ${MAX_CONCURRENT_RECORDS}). Stop one first.`);
  const existing = active.find((r) => r.url === url);
  if (existing) return json(res, 200, { id: existing.id, title: existing.title, seconds: Math.round((Date.now() - existing.startedAt) / 1000) });

  const jobId = id();
  await ensureCache();
  const rec = {
    id: jobId,
    child: null,
    done: null,
    file: mediaFile(`sl${jobId}`, "ts"),
    title: String(title || "").slice(0, 120) || "Stream recording",
    url: String(url),
    quality: quality === "smooth" ? "smooth" : "best",
    startedAt: Date.now(),
    status: "recording",
    err: "",
    killed: false,
  };
  recs.set(jobId, rec);
  void spawnStreamlink(rec);
  json(res, 200, { id: jobId, title: rec.title, seconds: 0 });
}

function secondsOf(rec) {
  if (rec.status !== "recording") return rec.seconds ?? 0;
  return Math.max(0, Math.round((Date.now() - rec.startedAt) / 1000));
}

async function apiStreamlinkList(_req, res) {
  const items = [];
  for (const rec of recs.values()) {
    const bytes = await fsp.stat(rec.file).then((s) => s.size).catch(() => 0);
    items.push({
      id: rec.id,
      title: rec.title,
      url: rec.url,
      status: rec.status,
      seconds: secondsOf(rec),
      bytes,
    });
  }
  json(res, 200, { recordings: items });
}

async function apiStreamlinkStatus(_req, res, query) {
  const rec = recs.get(query.get("id") || "");
  if (!rec) return json(res, 200, { status: "unknown", err: "Unknown recording" });
  const bytes = await fsp.stat(rec.file).then((s) => s.size).catch(() => 0);
  json(res, 200, {
    status: rec.status,
    seconds: secondsOf(rec),
    bytes,
    err: rec.err,
    title: rec.title,
  });
}

/** Stops a recording, losslessly remuxes to MP4, registers ready media (/media?id=…), returns metadata. */
async function apiStreamlinkStop(_req, res, query) {
  const rec = recs.get(query.get("id") || "");
  if (!rec) return fail(res, 404, "Unknown recording");
  if (rec.status === "recording") {
    rec.killed = true;
    try { rec.child?.kill(); } catch { /* already gone */ }
  }
  await rec.done;
  recs.delete(rec.id);
  if (rec.status === "failed") {
    await fsp.rm(rec.file, { force: true }).catch(() => {});
    return fail(res, 502, rec.err || "Streamlink failed to record that stream.");
  }

  const tsBytes = await fsp.stat(rec.file).then((s) => s.size).catch(() => 0);
  if (!tsBytes) {
    await fsp.rm(rec.file, { force: true }).catch(() => {});
    return fail(res, 502, "The recording came back empty — the stream may have ended.");
  }

  let finalFile = rec.file;
  let mime = "video/mp2t";
  const mp4File = mediaFile(`sl${rec.id}`, "mp4");
  if (await remuxTsToMp4(rec.file, mp4File)) {
    await fsp.rm(rec.file, { force: true }).catch(() => {});
    finalFile = mp4File;
    mime = "video/mp4";
  }

  const info = await probe(finalFile);
  if (!info.hasVideo && !(await fsp.stat(finalFile).then((s) => s.size).catch(() => 0))) {
    await fsp.rm(finalFile, { force: true }).catch(() => {});
    return fail(res, 502, "The recording came back empty — the stream may have ended.");
  }

  const seconds = Math.max(1, Math.round(info.duration > 0 ? info.duration : secondsOf(rec)));
  const bytes = await fsp.stat(finalFile).then((s) => s.size).catch(() => 0);
  const now = Date.now();
  mediaJobs.set(rec.id, {
    id: rec.id,
    status: "ready",
    file: finalFile,
    mime,
    err: "",
    title: rec.title,
    url: "",
    createdAt: now,
    accessedAt: now,
  });
  json(res, 200, {
    id: rec.id,
    title: rec.title,
    seconds,
    bytes,
    mime,
    alreadyFinalized: mime === "video/mp4",
    url: `/media?id=${rec.id}`,
    hasAudio: !!info.hasAudio,
    hasVideo: !!info.hasVideo,
  });
}

async function apiStreamlinkCancel(_req, res, query) {
  const rec = recs.get(query.get("id") || "");
  if (!rec) return json(res, 200, { ok: true });
  if (rec.status === "recording") {
    rec.killed = true;
    try { rec.child?.kill(); } catch { /* already gone */ }
  }
  await rec.done;
  recs.delete(rec.id);
  await fsp.rm(rec.file, { force: true }).catch(() => {});
  json(res, 200, { ok: true });
}

function killAllRecordings() {
  for (const rec of recs.values()) {
    try { rec.child?.kill("SIGKILL"); } catch { /* best effort */ }
  }
}

process.on("exit", killAllRecordings);
process.on("SIGINT", killAllRecordings);
process.on("SIGTERM", killAllRecordings);

module.exports = {
  "GET /api/streamlink/list": apiStreamlinkList,
  "POST /api/streamlink/record": apiStreamlinkRecord,
  "GET /api/streamlink/status": apiStreamlinkStatus,
  "POST /api/streamlink/stop": apiStreamlinkStop,
  "POST /api/streamlink/cancel": apiStreamlinkCancel,
};
