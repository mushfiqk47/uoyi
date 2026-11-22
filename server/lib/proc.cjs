"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

let nvenc = null;
let cachedOpenCvPython = undefined;

// Tools the Setup panel can install into <repo>/bin. When a local copy exists it is
// spawned by absolute path, so the app works without PATH edits on any machine/OS.
const LOCAL_TOOLS = new Set(["ffmpeg", "ffprobe", "yt-dlp", "streamlink", "scenedetect", "nemo-speech"]);
const TOOLS_DIR = process.env.CLIPWEAVE_TOOLS_DIR || path.join(ROOT, "bin");

/** Absolute path of an app-installed tool binary, or null. Checked per spawn (cheap stat). */
function resolveLocalTool(cmd) {
  if (!LOCAL_TOOLS.has(cmd)) return null;
  const exe = process.platform === "win32" ? `${cmd}.exe` : cmd;
  const p = path.join(TOOLS_DIR, exe);
  return fs.existsSync(p) ? p : null;
}

function run(cmd, args, { timeout = 0, cwd = ROOT, onSpawn, onStdout } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      const local = resolveLocalTool(cmd);
      child = spawn(local || cmd, args, { windowsHide: true, cwd });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String(e.message || e) });
      return;
    }
    onSpawn?.(child);
    let stdout = "";
    let stderr = "";
    let timer = 0;
    if (timeout) timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (d) => {
      const s = String(d);
      onStdout?.(s);
      stdout += s;
      if (stdout.length > 4e6) stdout = stdout.slice(-2e6);
    });
    child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 4e6) stderr = stderr.slice(-2e6); });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e.message || e) });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function hasTool(cmd, args = ["--version"]) {
  const r = await run(cmd, args, { timeout: 15000 });
  return r.code === 0;
}

async function findOpenCvPython() {
  if (cachedOpenCvPython !== undefined) return cachedOpenCvPython;
  const candidates = [process.env.CLIPWEAVE_PYTHON, "python3", "python"].filter(Boolean);
  for (const bin of candidates) {
    const r = await run(bin, ["-c", "import cv2"], { timeout: 8000 });
    if (r.code === 0) {
      cachedOpenCvPython = bin;
      return bin;
    }
  }
  cachedOpenCvPython = null;
  return null;
}

let cachedStreamlink = undefined;
/** Resolves how to invoke Streamlink: the pip `streamlink` launcher when on PATH, otherwise
 *  `python -m streamlink` (the module ships with the same CLI). Returns null when absent. */
async function findStreamlink() {
  if (cachedStreamlink !== undefined) return cachedStreamlink;
  if (await hasTool("streamlink", ["--version"])) {
    cachedStreamlink = { cmd: "streamlink", prefix: [] };
    return cachedStreamlink;
  }
  for (const bin of [process.env.CLIPWEAVE_PYTHON, "python3", "python"].filter(Boolean)) {
    const r = await run(bin, ["-m", "streamlink", "--version"], { timeout: 15000 });
    if (r.code === 0) {
      cachedStreamlink = { cmd: bin, prefix: ["-m", "streamlink"] };
      return cachedStreamlink;
    }
  }
  cachedStreamlink = null;
  return null;
}

let cachedScenedetect = undefined;
/** Resolves how to invoke PySceneDetect, mirroring findStreamlink: the pip `scenedetect`
 *  launcher when on PATH, otherwise `python -m scenedetect`. Returns null when absent. */
async function findScenedetect() {
  if (cachedScenedetect !== undefined) return cachedScenedetect;
  if (await hasTool("scenedetect", ["--version"])) {
    cachedScenedetect = { cmd: "scenedetect", prefix: [] };
    return cachedScenedetect;
  }
  for (const bin of [process.env.CLIPWEAVE_PYTHON, "python3", "python"].filter(Boolean)) {
    const r = await run(bin, ["-m", "scenedetect", "--version"], { timeout: 15000 });
    if (r.code === 0) {
      cachedScenedetect = { cmd: bin, prefix: ["-m", "scenedetect"] };
      return cachedScenedetect;
    }
  }
  cachedScenedetect = null;
  return null;
}

async function encoderArgs(opts) {
  if (nvenc === null) {
    const r = await run("ffmpeg", ["-hide_banner", "-encoders"], { timeout: 10000 });
    if (/\bh264_nvenc\b/.test(r.stdout)) {
      // Linux ffmpeg builds often list h264_nvenc even when no CUDA device exists; test-encode 1 frame.
      const test = await run(
        "ffmpeg",
        ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1", "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "-"],
        { timeout: 10000 },
      );
      nvenc = test.code === 0;
    } else {
      nvenc = false;
    }
  }
  return nvenc
    ? ["-c:v", "h264_nvenc", "-preset", opts?.nvencPreset || "p3", "-cq", "23", "-pix_fmt", "yuv420p"]
    : ["-c:v", "libx264", "-preset", opts?.preset || "superfast", "-crf", "21", "-threads", "0", "-pix_fmt", "yuv420p"];
}

/** True once detection has run and found NVENC. `null` (not probed yet) reports false. */
function nvencEnabled() {
  return !!nvenc;
}

async function probe(file) {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  if (r.code !== 0) return { width: 0, height: 0, duration: 0, hasAudio: false, hasVideo: false };
  let data = {};
  try { data = JSON.parse(r.stdout); } catch { /* unreadable */ }
  const streams = data.streams || [];
  const video = streams.find((s) => s.codec_type === "video");
  return {
    width: video?.width || 0,
    height: video?.height || 0,
    duration: Number(data.format?.duration) || Number(video?.duration) || 0,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    hasVideo: !!video,
  };
}

module.exports = { ROOT, TOOLS_DIR, resolveLocalTool, run, hasTool, findOpenCvPython, findStreamlink, findScenedetect, encoderArgs, nvencEnabled, probe };
