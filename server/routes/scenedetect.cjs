"use strict";

// Visual scene-change detection via PySceneDetect (https://github.com/Breakthrough/PySceneDetect).
// Decodes the media and reports every hard cut so the AI clip finder can place clip starts on
// clean visual boundaries — moments that transcript scoring alone misses (gameplay kills, scene
// transitions, edits) become candidates, and every saved cut starts on a real scene change.
// Runs as an async job (start + poll) because decoding a long VOD takes minutes; the client
// runs it in parallel with audio analysis, so it adds no wall time when both are needed.

const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { json, fail, readJson } = require("../lib/http.cjs");
const { findScenedetect, probe } = require("../lib/proc.cjs");
const { detectScenesFfmpeg } = require("../lib/signals.cjs");
const { tempDir } = require("../lib/files.cjs");
const { id } = require("../lib/id.cjs");
const { resolveMediaJob, touchEntry } = require("../state.cjs");

/** jobId -> { id, mediaId, child, done, dir, status, backend, err, startedAt, finishedAt, scenes, killed } */
const jobs = new Map();
const MAX_CONCURRENT_JOBS = 2;
const MAX_SCENES = 2000;
const MIN_SCENE_LEN = "1.5s";
const SCENE_TTL_MS = 30 * 60 * 1000;

const sceneTimer = setInterval(() => {
  const cutoff = Date.now() - SCENE_TTL_MS;
  for (const [key, rec] of jobs) {
    if (rec.status !== "running" && (rec.finishedAt || rec.startedAt) < cutoff) {
      jobs.delete(key);
    }
  }
}, 5 * 60 * 1000);
sceneTimer.unref?.();

function runChild(cmd, args, job) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String(e.message || e) });
      return;
    }
    job.child = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); if (stdout.length > 4e5) stdout = stdout.slice(-2e5); });
    child.stderr.on("data", (d) => { stderr += String(d); if (stderr.length > 4e5) stderr = stderr.slice(-2e5); });
    child.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e.message || e) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function readSceneCsv(dir, file) {
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  const names = await fsp.readdir(dir).catch(() => []);
  const csvName = names.find((n) => n.toLowerCase().endsWith(".csv")) || `${base}.Scenes.csv`;
  const text = await fsp.readFile(path.join(dir, csvName), "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  let cols = null;
  const scenes = [];
  for (const line of lines) {
    const cells = line.split(",").map((c) => c.trim());
    if (!cols) {
      const startIdx = cells.findIndex((c) => /^start time \(seconds\)$/i.test(c));
      const endIdx = cells.findIndex((c) => /^end time \(seconds\)$/i.test(c));
      if (startIdx >= 0 && endIdx >= 0) cols = { start: startIdx, end: endIdx };
      continue;
    }
    const start = Number(cells[cols.start]);
    const end = Number(cells[cols.end]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      scenes.push({ start, end, duration: Math.round((end - start) * 1000) / 1000 });
      if (scenes.length >= MAX_SCENES) break;
    }
  }
  return scenes;
}

function spawnScenedetect(job, file, dir) {
  job.done = (async () => {
    const tool = await findScenedetect();
    if (!tool) {
      job.backend = "ffmpeg";
      try {
        const info = await probe(file);
        job.scenes = await detectScenesFfmpeg(file, {
          threshold: 0.28,
          duration: info.duration || 0,
          minSceneLen: 1.5,
          maxScenes: MAX_SCENES,
        });
        job.status = "done";
      } catch (e) {
        job.status = "failed";
        job.err = String(e.message || e || "Scene detection failed");
      }
      job.finishedAt = Date.now();
      return { code: job.status === "done" ? 0 : -1, stdout: "", stderr: job.err };
    }

    job.backend = "pyscenedetect";
    const base = [...tool.prefix, "-i", file, "-m", MIN_SCENE_LEN, "-o", dir];
    let result = await runChild(tool.cmd, [...base, "detect-content", "list-scenes"], job);
    if (result.code !== 0 && /unrecognized|unknown/i.test(result.stderr)) {
      result = await runChild(tool.cmd, [...base, "--content-detector", "list-scenes"], job);
    }
    if (result.code !== 0 && /unrecognized|unknown/i.test(result.stderr)) {
      result = await runChild(tool.cmd, [...tool.prefix, "-i", file, "detect-content", "list-scenes", "-o", dir], job);
    }
    if (result.code !== 0) {
      job.status = "failed";
      job.err = result.stderr.split("\n").filter(Boolean).slice(-1)[0] || `scenedetect exited with code ${result.code}`;
      job.finishedAt = Date.now();
      return result;
    }
    try {
      job.scenes = await readSceneCsv(dir, file);
      job.status = "done";
    } catch (e) {
      job.status = "failed";
      job.err = `Could not read scene output: ${String(e.message || e)}`;
    }
    job.finishedAt = Date.now();
    return result;
  })();
  return job.done;
}

async function apiSceneDetectStart(req, res) {
  const { id: mediaId } = await readJson(req);
  const job = resolveMediaJob(String(mediaId || ""));
  if (!job || job.status !== "ready") return fail(res, 404, "Media isn't ready", "NOT_FOUND", req);
  touchEntry(job);
  const running = [...jobs.values()].filter((j) => j.status === "running");
  if (running.length >= MAX_CONCURRENT_JOBS) return fail(res, 429, `Too many scene detections at once (max ${MAX_CONCURRENT_JOBS}). Try again when one finishes.`, "BUSY", req);
  const existing = running.find((j) => j.mediaId === mediaId);
  if (existing) return json(res, 200, { id: existing.id, status: "running", backend: existing.backend }, req);

  const jobId = id();
  const dir = await tempDir("scenes-");
  const rec = {
    id: jobId,
    mediaId: String(mediaId),
    child: null,
    done: null,
    dir,
    status: "running",
    backend: "auto",
    err: "",
    startedAt: Date.now(),
    finishedAt: 0,
    scenes: [],
    killed: false,
  };
  jobs.set(jobId, rec);
  void spawnScenedetect(rec, job.file, dir).finally(() => {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  json(res, 200, { id: jobId, status: "running" });
}

async function apiSceneDetectStatus(_req, res, query) {
  const rec = jobs.get(query.get("id") || "");
  if (!rec) return json(res, 200, { status: "unknown", err: "Unknown scene detection job" });
  json(res, 200, {
    status: rec.status,
    backend: rec.backend,
    seconds: Math.round((Date.now() - rec.startedAt) / 1000),
    count: rec.scenes.length,
    err: rec.err,
    scenes: rec.status === "done" ? rec.scenes : undefined,
  });
}

async function apiSceneDetectCancel(_req, res, query) {
  const rec = jobs.get(query.get("id") || "");
  if (!rec) return json(res, 200, { ok: true });
  if (rec.status === "running") {
    rec.killed = true;
    rec.status = "failed";
    rec.err = "Cancelled";
    try { rec.child?.kill(); } catch { /* already gone */ }
    await rec.done?.catch(() => {});
  }
  await fsp.rm(rec.dir, { recursive: true, force: true }).catch(() => {});
  jobs.delete(rec.id);
  json(res, 200, { ok: true });
}

process.on("exit", () => {
  for (const rec of jobs.values()) {
    try { rec.child?.kill("SIGKILL"); } catch { /* best effort */ }
  }
});

module.exports = {
  "POST /api/scenedetect/start": apiSceneDetectStart,
  "GET /api/scenedetect/status": apiSceneDetectStatus,
  "POST /api/scenedetect/cancel": apiSceneDetectCancel,
};
