"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { run } = require("./proc.cjs");

/**
 * Parses FFmpeg ebur128 momentary loudness and silencedetect logs from stderr.
 * Returns ranked audio peak windows (>= minSpacingSec apart) and silence gaps.
 */
function parseLoudnessAndSilences(stderrText, { maxPeaks = 10, minSpacingSec = 8 } = {}) {
  const text = String(stderrText || "");
  const silences = [];
  let openStart = null;
  const momentary = [];

  for (const line of text.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([-\d.]+)/);
    if (startMatch) {
      openStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([-\d.]+)/);
    if (endMatch) {
      const end = Number(endMatch[1]);
      const start = openStart !== null ? openStart : Math.max(0, end - 0.5);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        silences.push({
          start: Math.round(start * 1000) / 1000,
          end: Math.round(end * 1000) / 1000,
        });
      }
      openStart = null;
      continue;
    }

    // [Parsed_ebur128...] t: 12.4   TARGET:-23 LUFS   M: -11.2 S: -13.1 ...
    if (line.includes("M:") && line.includes("t:")) {
      const tm = line.match(/t:\s*([\d.]+)/);
      const mm = line.match(/\bM:\s*([-\d.]+)/);
      if (tm && mm) {
        const time = Number(tm[1]);
        const lufs = Number(mm[1]);
        if (Number.isFinite(time) && Number.isFinite(lufs) && lufs > -70) {
          momentary.push({ time, lufs });
        }
      }
    }
  }

  // Pick top loudness spikes spaced at least minSpacingSec apart
  const sorted = [...momentary].sort((a, b) => b.lufs - a.lufs);
  const topPeaks = [];
  for (const cand of sorted) {
    if (topPeaks.some((p) => Math.abs(p.time - cand.time) < minSpacingSec)) continue;
    topPeaks.push({
      time: Math.round(cand.time * 100) / 100,
      lufs: Math.round(cand.lufs * 10) / 10,
    });
    if (topPeaks.length >= maxPeaks) break;
  }
  topPeaks.sort((a, b) => a.time - b.time);

  return { topPeaks, silences };
}

/**
 * Parses FFmpeg `select='gt(scene,...)',showinfo` stderr output into clean scene intervals.
 */
function parseSceneTimestamps(stderrText, { duration = 0, minSceneLen = 1.5, maxScenes = 2000 } = {}) {
  const text = String(stderrText || "");
  const cuts = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("pts_time:")) continue;
    const m = line.match(/pts_time:\s*([\d.]+)/);
    if (!m) continue;
    const t = Number(m[1]);
    if (!Number.isFinite(t) || t <= 0.1) continue;
    if (!cuts.length || t - cuts[cuts.length - 1] >= minSceneLen) {
      cuts.push(Math.round(t * 1000) / 1000);
    }
  }

  const endBoundary = duration > 0.2 ? duration : cuts.length ? cuts[cuts.length - 1] + minSceneLen : 0;
  const boundaries = [0, ...cuts.filter((t) => !duration || t < duration - 0.2), ...(endBoundary > 0.2 ? [endBoundary] : [])];
  const scenes = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = Math.round(boundaries[i] * 1000) / 1000;
    const end = Math.round(boundaries[i + 1] * 1000) / 1000;
    if (end - start >= 0.2) {
      scenes.push({ start, end, duration: Math.round((end - start) * 1000) / 1000 });
      if (scenes.length >= maxScenes) break;
    }
  }
  return scenes;
}

/** Runs single-pass FFmpeg audio loudness + silence analysis. Never throws on silent videos. */
async function analyzeAudioSignals(file, opts = {}) {
  const r = await run(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "info", "-nostats",
      "-i", file, "-vn",
      "-af", "silencedetect=n=-35dB:d=0.5,ebur128=peak=true",
      "-f", "null", "-",
    ],
    { timeout: opts.timeout ?? 120000 },
  );
  if (r.code !== 0 && !r.stderr) return { topPeaks: [], silences: [] };
  return parseLoudnessAndSilences(r.stderr, opts);
}

/** Fast FFmpeg fallback scene detector when PySceneDetect CLI isn't installed. */
async function detectScenesFfmpeg(file, { threshold = 0.28, duration = 0, minSceneLen = 1.5, maxScenes = 2000 } = {}) {
  const r = await run(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "info", "-nostats",
      "-i", file, "-an",
      "-vf", `select='gt(scene,${threshold})',showinfo`,
      "-f", "null", "-",
    ],
    { timeout: 0 },
  );
  if (r.code !== 0 && !r.stderr) {
    throw new Error("FFmpeg scene detection failed");
  }
  return parseSceneTimestamps(r.stderr, { duration, minSceneLen, maxScenes });
}

/**
 * Extracts evenly spaced storyboard JPEGs in a single FFmpeg decode pass instead of
 * spawning N separate processes. Also reports each frame's accurate timestamp.
 */
async function extractStoryboardFramesBatched(file, dir, duration, maxFrames = 10) {
  if (!duration || duration <= 0.5) return [];
  const count = Math.min(maxFrames, Math.max(3, Math.ceil(duration / 6)));
  const fpsRate = count / Math.max(1, duration);
  const pattern = path.join(dir, "frame_%02d.jpg");
  const r = await run(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", file, "-an",
      "-vf", `fps=${fpsRate.toFixed(6)},scale=640:-2`,
      "-frames:v", String(count),
      "-q:v", "5",
      pattern,
    ],
    { timeout: 120000 },
  );
  if (r.code !== 0) return [];
  const names = (await fsp.readdir(dir).catch(() => []))
    .filter((n) => /^frame_\d+\.jpg$/.test(n))
    .sort();
  return names.map((name, idx) => ({
    time: Number((((idx + 0.5) / Math.max(1, names.length)) * duration).toFixed(2)),
    path: path.join(dir, name),
  })).filter((f) => fs.existsSync(f.path));
}

module.exports = {
  parseLoudnessAndSilences,
  parseSceneTimestamps,
  analyzeAudioSignals,
  detectScenesFfmpeg,
  extractStoryboardFramesBatched,
};
