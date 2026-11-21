"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

let nvenc = null;
let cachedOpenCvPython = undefined;
let cachedYtDlp = undefined;
let resolvingYtDlp = null;

function run(cmd, args, { timeout = 0, cwd = ROOT, onSpawn, onStdout } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, cwd });
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

async function resolveYtDlp() {
  if (cachedYtDlp && (cachedYtDlp === "yt-dlp" || fs.existsSync(cachedYtDlp))) {
    return cachedYtDlp;
  }
  if (resolvingYtDlp) return resolvingYtDlp;
  resolvingYtDlp = (async () => {
    const candidates = [process.env.YTDLP_BIN, "yt-dlp"];
    try {
      const { constants } = require("youtube-dl-exec");
      if (constants?.YOUTUBE_DL_PATH) candidates.push(constants.YOUTUBE_DL_PATH);
    } catch {
      /* optional package */
    }
    const cacheBin = path.join(ROOT, ".cache", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    candidates.push(cacheBin);

    for (const bin of candidates.filter(Boolean)) {
      if (bin !== "yt-dlp" && !fs.existsSync(bin)) continue;
      if (await hasTool(bin, ["--version"])) {
        cachedYtDlp = bin;
        return bin;
      }
    }

    // Download yt-dlp zipapp once into .cache/bin if package postinstall scripts were skipped.
    try {
      const asset = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
      const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, {
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await fsp.mkdir(path.dirname(cacheBin), { recursive: true });
        const tmp = `${cacheBin}.tmp-${process.pid}`;
        await fsp.writeFile(tmp, buf);
        if (process.platform !== "win32") await fsp.chmod(tmp, 0o755);
        await fsp.rename(tmp, cacheBin);
        if (await hasTool(cacheBin, ["--version"])) {
          cachedYtDlp = cacheBin;
          return cacheBin;
        }
      }
    } catch {
      /* fall through */
    }
    return null;
  })().finally(() => {
    resolvingYtDlp = null;
  });
  return resolvingYtDlp;
}

function friendlyYtDlpError(stderr, fallback = "yt-dlp couldn't resolve that link.") {
  const raw = String(stderr || "");
  if (/sign in to confirm|not a bot|cookies-from-browser/i.test(raw)) {
    return "YouTube blocked server-side extraction from this cloud IP. Use Capture Tab in the Viewer to capture any playing YouTube tab, or upload the video file in Clips.";
  }
  const line = raw.split("\n").filter(Boolean).slice(-1)[0];
  return line || fallback;
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
    ? ["-c:v", "h264_nvenc", "-preset", "p3", "-cq", "23", "-pix_fmt", "yuv420p"]
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

module.exports = { ROOT, run, hasTool, resolveYtDlp, friendlyYtDlpError, findOpenCvPython, encoderArgs, nvencEnabled, probe };
