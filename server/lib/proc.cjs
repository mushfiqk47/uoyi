"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ROOT, DATA_DIR } = require("./paths.cjs");

let detectedGpu = undefined; // undefined = not probed, null = CPU only, or { id, codec, label }
let cachedOpenCvPython = undefined;
let cachedStreamlink = undefined;
let cachedScenedetect = undefined;

const LOCAL_TOOLS = new Set(["ffmpeg", "ffprobe", "yt-dlp", "streamlink", "scenedetect", "nemo-speech"]);
const TOOLS_DIR = process.env.CLIPWEAVE_TOOLS_DIR || path.join(DATA_DIR, "bin");
const LEGACY_TOOLS_DIR = path.join(ROOT, "bin");
const VENV_DIR = process.env.CLIPWEAVE_VENV_DIR || path.join(DATA_DIR, "venv");
const VENV_BIN_DIR = path.join(VENV_DIR, process.platform === "win32" ? "Scripts" : "bin");

function resetToolCaches() {
  cachedOpenCvPython = undefined;
  cachedStreamlink = undefined;
  cachedScenedetect = undefined;
}

function venvPythonPath() {
  const exe = process.platform === "win32" ? "python.exe" : "python3";
  const candidate = path.join(VENV_BIN_DIR, exe);
  if (fs.existsSync(candidate)) return candidate;
  const alt = path.join(VENV_BIN_DIR, "python");
  return fs.existsSync(alt) ? alt : null;
}

function pythonCandidates() {
  return [process.env.CLIPWEAVE_PYTHON, venvPythonPath(), "python3", "python"].filter(Boolean);
}

/** Absolute path of an app-installed tool binary, or null. Checks DATA_DIR/bin, venv, and legacy <ROOT>/bin. */
function resolveLocalTool(cmd) {
  if (!LOCAL_TOOLS.has(cmd)) return null;
  const exe = process.platform === "win32" ? `${cmd}.exe` : cmd;
  for (const dir of [TOOLS_DIR, VENV_BIN_DIR, LEGACY_TOOLS_DIR]) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
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
  for (const bin of pythonCandidates()) {
    const r = await run(bin, ["-c", "import cv2"], { timeout: 8000 });
    if (r.code === 0) {
      cachedOpenCvPython = bin;
      return bin;
    }
  }
  cachedOpenCvPython = null;
  return null;
}

async function findStreamlink() {
  if (cachedStreamlink !== undefined) return cachedStreamlink;
  if (await hasTool("streamlink", ["--version"])) {
    cachedStreamlink = { cmd: resolveLocalTool("streamlink") || "streamlink", prefix: [] };
    return cachedStreamlink;
  }
  for (const bin of pythonCandidates()) {
    const r = await run(bin, ["-m", "streamlink", "--version"], { timeout: 15000 });
    if (r.code === 0) {
      cachedStreamlink = { cmd: bin, prefix: ["-m", "streamlink"] };
      return cachedStreamlink;
    }
  }
  cachedStreamlink = null;
  return null;
}

async function findScenedetect() {
  if (cachedScenedetect !== undefined) return cachedScenedetect;
  if (await hasTool("scenedetect", ["--version"])) {
    cachedScenedetect = { cmd: resolveLocalTool("scenedetect") || "scenedetect", prefix: [] };
    return cachedScenedetect;
  }
  for (const bin of pythonCandidates()) {
    const r = await run(bin, ["-m", "scenedetect", "--version"], { timeout: 15000 });
    if (r.code === 0) {
      cachedScenedetect = { cmd: bin, prefix: ["-m", "scenedetect"] };
      return cachedScenedetect;
    }
  }
  cachedScenedetect = null;
  return null;
}

function gpuCandidatesForPlatform(platform = process.platform) {
  if (platform === "darwin") {
    return [{ id: "videotoolbox", codec: "h264_videotoolbox", label: "Apple VideoToolbox" }];
  }
  if (platform === "win32") {
    return [
      { id: "nvenc", codec: "h264_nvenc", label: "NVIDIA NVENC" },
      { id: "amf", codec: "h264_amf", label: "AMD AMF" },
      { id: "qsv", codec: "h264_qsv", label: "Intel QuickSync" },
    ];
  }
  return [
    { id: "nvenc", codec: "h264_nvenc", label: "NVIDIA NVENC" },
    { id: "qsv", codec: "h264_qsv", label: "Intel QuickSync" },
    { id: "vaapi", codec: "h264_vaapi", label: "Linux VAAPI" },
  ];
}

async function detectHardwareEncoder() {
  if (detectedGpu !== undefined) return detectedGpu;
  const r = await run("ffmpeg", ["-hide_banner", "-encoders"], { timeout: 10000 });
  if (r.code !== 0) {
    detectedGpu = null;
    return null;
  }
  const candidates = gpuCandidatesForPlatform();
  for (const cand of candidates) {
    if (!new RegExp(`\\b${cand.codec}\\b`).test(r.stdout)) continue;
    const args =
      cand.id === "vaapi"
        ? ["-y", "-hide_banner", "-loglevel", "error", "-vaapi_device", "/dev/dri/renderD128", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1", "-vf", "format=nv12,hwupload", "-frames:v", "1", "-c:v", "h264_vaapi", "-f", "null", "-"]
        : ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1", "-frames:v", "1", "-c:v", cand.codec, "-f", "null", "-"];
    const test = await run("ffmpeg", args, { timeout: 10000 });
    if (test.code === 0) {
      detectedGpu = cand;
      return detectedGpu;
    }
  }
  detectedGpu = null;
  return null;
}

async function encoderArgs(opts) {
  const gpu = await detectHardwareEncoder();
  if (gpu?.id === "nvenc") {
    return ["-c:v", "h264_nvenc", "-preset", opts?.nvencPreset || "p3", "-cq", "23", "-pix_fmt", "yuv420p"];
  }
  if (gpu?.id === "videotoolbox") {
    return ["-c:v", "h264_videotoolbox", "-q:v", "65", "-pix_fmt", "yuv420p"];
  }
  if (gpu?.id === "amf") {
    return ["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "22", "-qp_p", "22", "-pix_fmt", "yuv420p"];
  }
  if (gpu?.id === "qsv") {
    return ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "23", "-pix_fmt", "yuv420p"];
  }
  const cores = os.cpus().length;
  const fallbackPreset = cores <= 4 ? "ultrafast" : opts?.preset || "superfast";
  return ["-c:v", "libx264", "-preset", fallbackPreset, "-crf", "21", "-threads", "0", "-pix_fmt", "yuv420p"];
}

function activeGpuEncoder() {
  return detectedGpu || null;
}

function nvencEnabled() {
  return detectedGpu?.id === "nvenc";
}

function systemHardwareProfile() {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    gpu: detectedGpu || null,
  };
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

module.exports = {
  ROOT,
  TOOLS_DIR,
  VENV_DIR,
  VENV_BIN_DIR,
  resetToolCaches,
  venvPythonPath,
  resolveLocalTool,
  run,
  hasTool,
  findOpenCvPython,
  findStreamlink,
  findScenedetect,
  gpuCandidatesForPlatform,
  detectHardwareEncoder,
  encoderArgs,
  activeGpuEncoder,
  nvencEnabled,
  systemHardwareProfile,
  probe,
};
