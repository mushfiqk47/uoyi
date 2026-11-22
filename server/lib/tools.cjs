"use strict";

// Cross-platform tool provisioning for Setup & First-Run Readiness. Every installer writes
// into OS user data directories (DATA_DIR/bin, DATA_DIR/venv, DATA_DIR/models, DATA_DIR/transcript).
// Never modifies global PATH or system Program Files / /Applications install folders.

const fsp = require("node:fs/promises");
const fs = require("node:fs");
const path = require("node:path");
const {
  run,
  hasTool,
  TOOLS_DIR,
  VENV_DIR,
  venvPythonPath,
  resolveLocalTool,
  resetToolCaches,
  findOpenCvPython,
  findStreamlink,
  findScenedetect,
  detectHardwareEncoder,
  systemHardwareProfile,
} = require("./proc.cjs");
const { DATA_DIR, getFreeDiskBytes, getConfiguredWorkspaceDir } = require("./paths.cjs");
const { downloadFile, extractZipNode, ensureRuntime, resolveCli, modelInstalled, AUDIOCPP_VERSION } = require("./audiocpp.cjs");
const { archiveLooksValid } = require("./archive.cjs");

function localToolPath(name) {
  return path.join(TOOLS_DIR, process.platform === "win32" ? `${name}.exe` : name);
}

async function ensureDiskSpace(bytesNeeded, targetDir = TOOLS_DIR) {
  await fsp.mkdir(targetDir, { recursive: true });
  const disk = await getFreeDiskBytes(targetDir);
  if (disk && disk.freeBytes < bytesNeeded) {
    const needMb = Math.ceil(bytesNeeded / (1024 * 1024));
    const freeMb = Math.floor(disk.freeBytes / (1024 * 1024));
    throw new Error(`Not enough free disk space (${freeMb} MB free, ~${needMb} MB needed).`);
  }
}

async function findSystemPython() {
  for (const bin of [process.env.CLIPWEAVE_PYTHON, "python3", "python"].filter(Boolean)) {
    const r = await run(bin, ["--version"], { timeout: 15000 });
    if (r.code === 0) return bin;
  }
  return null;
}

/** Installs an optional Python package into an isolated app-private venv first, avoiding global site-packages pollution. */
async function pipInstall(pkg, onLog = () => {}) {
  await ensureDiskSpace(300 * 1024 * 1024, DATA_DIR);
  const sysPython = await findSystemPython();
  if (!sysPython && !venvPythonPath()) {
    throw new Error("Python 3 was not found. Install Python 3 or run this optional tool manually.");
  }

  let venvPy = venvPythonPath();
  if (!venvPy && sysPython) {
    onLog("Creating isolated ClipWeave Python environment…", 10);
    const mk = await run(sysPython, ["-m", "venv", VENV_DIR], { timeout: 120000 });
    if (mk.code === 0) {
      venvPy = venvPythonPath();
    }
  }

  if (venvPy) {
    onLog(`Installing ${pkg} into isolated app environment…`, 35);
    const r = await run(venvPy, ["-m", "pip", "install", "--upgrade", pkg], { timeout: 0 });
    if (r.code === 0) {
      resetToolCaches();
      onLog(`${pkg} ready.`, 100);
      return;
    }
    const errTail = String(r.stderr || r.stdout || "failed").trim().split("\n").slice(-1)[0];
    throw new Error(`Couldn't install ${pkg}: ${errTail}`);
  }

  // Fallback when system python lacks python3-venv
  const attempts = [["--user"], ["--user", "--break-system-packages"]];
  const errors = [];
  for (const flags of attempts) {
    onLog(`Installing ${pkg} via pip…`, 35);
    const r = await run(sysPython, ["-m", "pip", "install", ...flags, pkg], { timeout: 0 });
    if (r.code === 0) {
      resetToolCaches();
      onLog(`${pkg} ready.`, 100);
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
  await ensureDiskSpace(40 * 1024 * 1024, TOOLS_DIR);
  const dest = localToolPath("yt-dlp");
  onLog(`Downloading yt-dlp (${asset})…`, 0);
  await downloadFile(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, dest, (pct) => onLog(`Downloading yt-dlp… ${pct}%`, pct));
  if (process.platform !== "win32") await fsp.chmod(dest, 0o755);
  onLog("yt-dlp installed.", 100);
}

/** Windows: gyan.dev essentials zip contains ffmpeg/ffprobe under a nested bin/ folder. */
async function installFfmpegWindows(onLog) {
  const url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
  await ensureDiskSpace(300 * 1024 * 1024, TOOLS_DIR);
  const zipPath = path.join(TOOLS_DIR, "ffmpeg-release-essentials.zip");
  const tmp = path.join(TOOLS_DIR, `.extract-${Date.now()}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    onLog("Downloading FFmpeg (Windows static build, ~80 MB)…", 0);
    await downloadFile(url, zipPath, (pct) => onLog(`Downloading FFmpeg… ${pct}%`, pct));
    if (!(await archiveLooksValid(zipPath, "zip"))) throw new Error("Downloaded FFmpeg zip appears incomplete.");
    onLog("Extracting…", 95);
    extractZipNode(zipPath, tmp);
    for (const name of ["ffmpeg.exe", "ffprobe.exe"]) {
      const hits = await findFileInTree(tmp, (f) => f.toLowerCase() === name);
      if (!hits.length) throw new Error(`${name} was not in the archive`);
      await fsp.copyFile(hits[0], localToolPath(name.replace(".exe", "")));
    }
    onLog("FFmpeg + FFprobe installed.", 100);
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    fsp.rm(zipPath, { force: true }).catch(() => {});
  }
}

/** macOS: evermeet.cx ships ffmpeg and ffprobe as separate single-binary zips. */
async function installFfmpegMac(onLog) {
  await ensureDiskSpace(250 * 1024 * 1024, TOOLS_DIR);
  for (const name of ["ffmpeg", "ffprobe"]) {
    const zipPath = path.join(TOOLS_DIR, `${name}.zip`);
    const tmp = path.join(TOOLS_DIR, `.extract-${name}-${Date.now()}`);
    await fsp.mkdir(tmp, { recursive: true });
    try {
      onLog(`Downloading ${name} (macOS build)…`, 0);
      await downloadFile(`https://evermeet.cx/ffmpeg/getrelease/${name === "ffmpeg" ? "" : "ffprobe/"}zip`, zipPath, (pct) => onLog(`Downloading ${name}… ${pct}%`, pct));
      if (!(await archiveLooksValid(zipPath, "zip"))) throw new Error(`Downloaded ${name} archive appears incomplete.`);
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
  onLog("FFmpeg + FFprobe installed.", 100);
}

/** Linux: johnvansickle static tar.xz — checks xz availability before extracting. */
async function installFfmpegLinux(onLog) {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const url = `https://www.johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch}-static.tar.xz`;
  await ensureDiskSpace(200 * 1024 * 1024, TOOLS_DIR);
  const archive = path.join(TOOLS_DIR, `ffmpeg-release-${arch}-static.tar.xz`);
  const tmp = path.join(TOOLS_DIR, `.extract-${Date.now()}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    onLog("Downloading FFmpeg (Linux static build, ~40 MB)…", 0);
    await downloadFile(url, archive, (pct) => onLog(`Downloading FFmpeg… ${pct}%`, pct));
    if (!(await archiveLooksValid(archive, "tar.xz"))) throw new Error("Downloaded FFmpeg tar.xz appears incomplete.");
    onLog("Extracting…", 95);
    const r = await run("tar", ["-xf", archive, "-C", tmp], { timeout: 600000 });
    if (r.code !== 0) {
      throw new Error(`Could not extract FFmpeg tar.xz (${String(r.stderr || r.stdout || "failed").trim().slice(-120)}). Install ffmpeg or xz via your system package manager.`);
    }
    for (const name of ["ffmpeg", "ffprobe"]) {
      const hits = await findFileInTree(tmp, (f) => f === name);
      if (!hits.length) throw new Error(`${name} was not in the archive`);
      const dest = localToolPath(name);
      await fsp.copyFile(hits[0], dest);
      await fsp.chmod(dest, 0o755);
    }
    onLog("FFmpeg + FFprobe installed.", 100);
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
  onLog("Downloading the Parakeet caption model (~916 MB)…");
  const { downloadModel } = require("./audiocpp.cjs");
  await downloadModel("parakeet-tdt", (s, pct) => onLog(s, pct));
  onLog("Local transcription ready (audio.cpp + Parakeet TDT).", 100);
}

const INSTALLERS = {
  ffmpeg: installFfmpeg,
  "yt-dlp": installYtDlp,
  audiocpp: installAudiocpp,
  streamlink: (onLog) => pipInstall("streamlink", onLog),
  scenedetect: (onLog) => pipInstall("scenedetect", onLog),
  opencv: (onLog) => pipInstall("opencv-python", onLog),
};

/** Everything the Setup panel & First-Run wizard check, with Required / Recommended / Optional tiers and machine telemetry. */
async function setupStatus() {
  const [ffRun, fpRun, ytdlpRun, pythonBin] = await Promise.all([
    run("ffmpeg", ["-version"], { timeout: 15000 }),
    run("ffprobe", ["-version"], { timeout: 15000 }),
    run("yt-dlp", ["--version"], { timeout: 15000 }),
    findSystemPython(),
  ]);
  const versionLine = (r) => String(r.stdout || "").split("\n")[0].trim().slice(0, 60);
  const ffOk = ffRun.code === 0;
  const fpOk = fpRun.code === 0;
  if (ffOk) await detectHardwareEncoder();
  const [streamlink, scenedetect, opencv, audiocpp, parakeet, dataDisk, workspaceDisk] = await Promise.all([
    findStreamlink().then((t) => !!t),
    findScenedetect().then((t) => !!t),
    findOpenCvPython().then((t) => !!t),
    resolveCli().then((c) => !!c),
    modelInstalled("parakeet-tdt"),
    getFreeDiskBytes(DATA_DIR),
    getFreeDiskBytes(getConfiguredWorkspaceDir()),
  ]);

  const source = (local) => (resolveLocalTool(local) ? "app" : "path");
  const items = [
    {
      id: "ffmpeg",
      label: "FFmpeg + FFprobe",
      tier: "required",
      required: true,
      installed: ffOk && fpOk,
      source: ffOk ? source("ffmpeg") : "missing",
      version: ffOk ? versionLine(ffRun) : "",
      sizeLabel: "~80 MB",
      estimatedBytes: 90 * 1024 * 1024,
      note: "Required for fast MP4 rendering, clip cutting, audio extraction, and file probing.",
    },
    {
      id: "yt-dlp",
      label: "yt-dlp",
      tier: "recommended",
      required: false,
      installed: ytdlpRun.code === 0,
      source: ytdlpRun.code === 0 ? source("yt-dlp") : "missing",
      version: ytdlpRun.code === 0 ? versionLine(ytdlpRun) : "",
      sizeLabel: "~15 MB",
      estimatedBytes: 20 * 1024 * 1024,
      note: "Recommended for opening Twitch, Kick, and YouTube links directly. Not needed for local video files.",
    },
    {
      id: "audiocpp",
      label: "Local Speech-to-Text (audio.cpp + Parakeet)",
      tier: "recommended",
      required: false,
      installed: audiocpp && parakeet,
      source: audiocpp ? "app" : "missing",
      version: audiocpp ? `audio.cpp ${AUDIOCPP_VERSION}` : "",
      sizeLabel: "~950 MB",
      estimatedBytes: 960 * 1024 * 1024,
      note: "Recommended for private offline captions and AI clip discovery without uploading audio.",
    },
    {
      id: "streamlink",
      label: "Streamlink",
      tier: "required",
      required: true,
      installed: streamlink,
      source: streamlink ? (venvPythonPath() && fs.existsSync(venvPythonPath()) ? "app" : "path") : "missing",
      version: "",
      sizeLabel: "~30 MB",
      estimatedBytes: 40 * 1024 * 1024,
      note: "Required for server-side stream recording at source quality (installs into an isolated app Python env).",
    },
    {
      id: "scenedetect",
      label: "PySceneDetect",
      tier: "required",
      required: true,
      installed: scenedetect,
      source: scenedetect ? (venvPythonPath() && fs.existsSync(venvPythonPath()) ? "app" : "path") : "missing",
      version: "",
      sizeLabel: "~85 MB",
      estimatedBytes: 100 * 1024 * 1024,
      note: "Required for sharper shot-boundary detection and better AI clip starts (FFmpeg fallback still works).",
    },
    {
      id: "opencv",
      label: "OpenCV Facecam Detector",
      tier: "required",
      required: true,
      installed: opencv,
      source: opencv ? (venvPythonPath() && fs.existsSync(venvPythonPath()) ? "app" : "path") : "missing",
      version: "",
      sizeLabel: "~90 MB",
      estimatedBytes: 110 * 1024 * 1024,
      note: "Required for automatic offline facecam framing in Split layout (YuNet ONNX model bundled).",
    },
  ];

  return {
    items,
    system: {
      ...systemHardwareProfile(),
      pythonAvailable: !!pythonBin,
      dataDir: DATA_DIR,
      workspaceDir: getConfiguredWorkspaceDir(),
      freeDataBytes: dataDisk?.freeBytes ?? null,
      freeWorkspaceBytes: workspaceDisk?.freeBytes ?? null,
    },
  };
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

module.exports = {
  setupStatus,
  installerFor,
  toolInstalled,
  localToolPath,
  findFileInTree,
  ytDlpAssetName,
  TOOLS_DIR,
};
