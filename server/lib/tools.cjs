"use strict";

// Cross-platform tool provisioning for the Settings → Setup panel. Every installer writes
// into the repo's bin/ folder (env CLIPWEAVE_TOOLS_DIR overrides); proc.cjs prefers those
// binaries when spawning, so nothing is added to PATH and no shell restart is needed.
// Sources: yt-dlp GitHub latest (single-file binary per OS), FFmpeg static builds
// (gyan.dev zip on Windows, johnvansickle tar.xz on Linux, evermeet zips on macOS),
// Python packages via the first available interpreter's pip, and the audio.cpp runtime.

const fsp = require("node:fs/promises");
const fs = require("node:fs");
const path = require("node:path");
const { run, hasTool, TOOLS_DIR, resolveLocalTool, findOpenCvPython, findStreamlink, findScenedetect } = require("./proc.cjs");
const { downloadFile, extractZipNode, ensureRuntime, resolveCli, modelInstalled, AUDIOCPP_VERSION } = require("./audiocpp.cjs");

function localToolPath(name) {
  return path.join(TOOLS_DIR, process.platform === "win32" ? `${name}.exe` : name);
}

/** Runs pip install with sensible fallbacks for PEP 668 (externally managed) environments. */
async function pipInstall(pkg, onLog = () => {}) {
  let python = null;
  for (const bin of [process.env.CLIPWEAVE_PYTHON, "python3", "python"].filter(Boolean)) {
    const r = await run(bin, ["--version"], { timeout: 15000 });
    if (r.code === 0) {
      python = bin;
      break;
    }
  }
  if (!python) throw new Error("Python 3 was not found. Install Python (python.org or your package manager) and run Setup again.");
  const attempts = [["--user"], ["--user", "--break-system-packages"]];
  const errors = [];
  for (const flags of attempts) {
    onLog(`Installing ${pkg} via pip…`, 0);
    const r = await run(python, ["-m", "pip", "install", ...flags, pkg], { timeout: 0 });
    if (r.code === 0) {
      onLog(`${pkg} installed.`);
      return;
    }
    errors.push(String(r.stderr || r.stdout || "failed").trim().split("\n").slice(-1)[0]);
  }
  throw new Error(`pip install ${pkg} failed: ${errors.join(" | ")}`);
}

/** Locates executables matching a predicate inside an extraction tree. */
async function findFileInTree(root, predicate) {
  const stack = [root];
  const hits = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (predicate(entry.name)) hits.push(full);
    }
  }
  return hits;
}

/** Official yt-dlp release asset for a platform/arch. */
function ytDlpAssetName(platform = process.platform, arch = process.arch) {
  if (platform === "win32") return "yt-dlp.exe";
  if (platform === "darwin") return "yt-dlp_macos";
  return arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
}

async function installYtDlp(onLog = () => {}) {
  const asset = ytDlpAssetName();
  await fsp.mkdir(TOOLS_DIR, { recursive: true });
  const dest = localToolPath("yt-dlp");
  onLog(`Downloading yt-dlp (${asset})…`, 0);
  await downloadFile(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, dest, (pct) => onLog(`Downloading yt-dlp… ${pct}%`, pct));
  if (process.platform !== "win32") await fsp.chmod(dest, 0o755);
  onLog("yt-dlp installed into the app bin folder.");
}

/** Windows: gyan.dev essentials zip contains ffmpeg/ffprobe under a nested bin/ folder. */
async function installFfmpegWindows(onLog) {
  const url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
  const zipPath = path.join(TOOLS_DIR, "ffmpeg-release-essentials.zip");
  const tmp = path.join(TOOLS_DIR, `.extract-${Date.now()}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    onLog(`Downloading FFmpeg (Windows static build, ~80 MB)…`, 0);
    await downloadFile(url, zipPath, (pct) => onLog(`Downloading FFmpeg… ${pct}%`, pct));
    onLog("Extracting…");
    extractZipNode(zipPath, tmp);
    for (const name of ["ffmpeg.exe", "ffprobe.exe"]) {
      const hits = await findFileInTree(tmp, (f) => f.toLowerCase() === name);
      if (!hits.length) throw new Error(`${name} was not in the archive`);
      await fsp.copyFile(hits[0], localToolPath(name.replace(".exe", "")));
    }
    onLog("FFmpeg + FFprobe installed into the app bin folder.");
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    fsp.rm(zipPath, { force: true }).catch(() => {});
  }
}

/** macOS: evermeet.cx ships ffmpeg and ffprobe as separate single-binary zips. */
async function installFfmpegMac(onLog) {
  await fsp.mkdir(TOOLS_DIR, { recursive: true });
  for (const name of ["ffmpeg", "ffprobe"]) {
    const zipPath = path.join(TOOLS_DIR, `${name}.zip`);
    const tmp = path.join(TOOLS_DIR, `.extract-${name}-${Date.now()}`);
    await fsp.mkdir(tmp, { recursive: true });
    try {
      onLog(`Downloading ${name} (macOS static build)…`, 0);
      await downloadFile(`https://evermeet.cx/ffmpeg/getrelease/${name === "ffmpeg" ? "" : "ffprobe/"}zip`, zipPath, (pct) => onLog(`Downloading ${name}… ${pct}%`, pct));
      extractZipNode(zipPath, tmp);
      const hits = await findFileInTree(tmp, (f) => f === name);
      if (!hits.length) throw new Error(`${name} was not in the archive`);
      const dest = localToolPath(name);
      await fsp.copyFile(hits[0], dest);
      await fsp.chmod(dest, 0o755);
    } finally {
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      fsp.rm(zipPath, { force: true }).catch(() => {});
    }
  }
  onLog("FFmpeg + FFprobe installed into the app bin folder.");
}

/** Linux: johnvansickle static tar.xz — extracted with the system tar (handles xz). */
async function installFfmpegLinux(onLog) {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const url = `https://www.johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch}-static.tar.xz`;
  const archive = path.join(TOOLS_DIR, `ffmpeg-release-${arch}-static.tar.xz`);
  const tmp = path.join(TOOLS_DIR, `.extract-${Date.now()}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    onLog(`Downloading FFmpeg (Linux static build, ~40 MB)…`, 0);
    await downloadFile(url, archive, (pct) => onLog(`Downloading FFmpeg… ${pct}%`, pct));
    onLog("Extracting…");
    const r = await run("tar", ["-xf", archive, "-C", tmp], { timeout: 600000 });
    if (r.code !== 0) {
      throw new Error(`tar could not extract the xz archive (${String(r.stderr || r.stdout || "failed").trim().slice(-120)}). Install xz-utils and run Setup again.`);
    }
    for (const name of ["ffmpeg", "ffprobe"]) {
      const hits = await findFileInTree(tmp, (f) => f === name);
      if (!hits.length) throw new Error(`${name} was not in the archive`);
      const dest = localToolPath(name);
      await fsp.copyFile(hits[0], dest);
      await fsp.chmod(dest, 0o755);
    }
    onLog("FFmpeg + FFprobe installed into the app bin folder.");
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    fsp.rm(archive, { force: true }).catch(() => {});
  }
}

async function installFfmpeg(onLog = () => {}) {
  if (process.platform === "win32") return installFfmpegWindows(onLog);
  if (process.platform === "darwin") return installFfmpegMac(onLog);
  return installFfmpegLinux(onLog);
}

async function installAudiocpp(onLog = () => {}) {
  await ensureRuntime(onLog);
  onLog("Downloading the Parakeet caption model…");
  const { downloadModel } = require("./audiocpp.cjs");
  await downloadModel("parakeet-tdt", (s, pct) => onLog(s, pct));
  onLog("Transcription is ready (audio.cpp + Parakeet TDT).");
}

const INSTALLERS = {
  ffmpeg: installFfmpeg,
  "yt-dlp": installYtDlp,
  audiocpp: installAudiocpp,
  streamlink: (onLog) => pipInstall("streamlink", onLog),
  scenedetect: (onLog) => pipInstall("scenedetect", onLog),
  opencv: (onLog) => pipInstall("opencv-python", onLog),
};

/** Everything the Setup panel can install, with live system status for each. */
async function setupStatus() {
  const [ffRun, fpRun, ytdlpRun] = await Promise.all([
    run("ffmpeg", ["-version"], { timeout: 15000 }),
    run("ffprobe", ["-version"], { timeout: 15000 }),
    run("yt-dlp", ["--version"], { timeout: 15000 }),
  ]);
  const versionLine = (r) => String(r.stdout || "").split("\n")[0].trim().slice(0, 60);
  const ffOk = ffRun.code === 0;
  const fpOk = fpRun.code === 0;
  const [streamlink, scenedetect, opencv, audiocpp, parakeet] = await Promise.all([
    findStreamlink().then((t) => !!t),
    findScenedetect().then((t) => !!t),
    findOpenCvPython().then((t) => !!t),
    resolveCli().then((c) => !!c),
    modelInstalled("parakeet-tdt"),
  ]);

  const source = (local) => (resolveLocalTool(local) ? "app" : "path");
  return [
    {
      id: "ffmpeg",
      label: "FFmpeg + FFprobe",
      required: true,
      installed: ffOk && fpOk,
      source: ffOk ? source("ffmpeg") : "missing",
      version: ffOk ? versionLine(ffRun) : "",
      note: "Clip finalization, cuts, renders, audio extraction. Installs a static build per OS.",
    },
    {
      id: "yt-dlp",
      label: "yt-dlp",
      required: true,
      installed: ytdlpRun.code === 0,
      source: ytdlpRun.code === 0 ? source("yt-dlp") : "missing",
      version: ytdlpRun.code === 0 ? versionLine(ytdlpRun) : "",
      note: "Resolves Twitch/Kick/YouTube links and prepares VODs. Installs the official single-file binary.",
    },
    {
      id: "audiocpp",
      label: "audio.cpp runtime + Parakeet model",
      required: true,
      installed: audiocpp && parakeet,
      source: audiocpp ? "app" : "missing",
      version: audiocpp ? `audio.cpp ${AUDIOCPP_VERSION}` : "",
      note: "Local transcription for captions and AI clip finding. Downloads the prebuilt runtime and default model.",
    },
    {
      id: "streamlink",
      label: "Streamlink (optional)",
      required: false,
      installed: streamlink,
      source: streamlink ? "path" : "missing",
      version: "",
      note: "Server-side live recording at original quality. Installs via pip (needs Python 3).",
    },
    {
      id: "scenedetect",
      label: "PySceneDetect (optional)",
      required: false,
      installed: scenedetect,
      source: scenedetect ? "path" : "missing",
      version: "",
      note: "Scene-aware AI clip finding. Installs via pip (needs Python 3).",
    },
    {
      id: "opencv",
      label: "OpenCV Python (optional)",
      required: false,
      installed: opencv,
      source: opencv ? "path" : "missing",
      version: "",
      note: "Facecam detection in the Editor. Installs opencv-python via pip (needs Python 3).",
    },
  ];
}

function installerFor(id) {
  return INSTALLERS[String(id || "")] || null;
}

/** True when the tool is already usable (installers are skipped for these). */
async function toolInstalled(id) {
  if (id === "audiocpp") return (await resolveCli()) && (await modelInstalled("parakeet-tdt"));
  if (id === "ffmpeg") return (await hasTool("ffmpeg", ["-version"])) && (await hasTool("ffprobe", ["-version"]));
  if (id === "yt-dlp") return hasTool("yt-dlp", ["--version"]);
  if (id === "streamlink") return findStreamlink().then((t) => !!t);
  if (id === "scenedetect") return findScenedetect().then((t) => !!t);
  if (id === "opencv") return findOpenCvPython().then((t) => !!t);
  return false;
}

module.exports = { setupStatus, installerFor, toolInstalled, localToolPath, findFileInTree, ytDlpAssetName, TOOLS_DIR };
