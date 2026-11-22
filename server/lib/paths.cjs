"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const RESERVED_WIN_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function resolveDataDir(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  if (env.CLIPWEAVE_DATA_DIR && String(env.CLIPWEAVE_DATA_DIR).trim()) {
    return path.resolve(String(env.CLIPWEAVE_DATA_DIR).trim());
  }
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    return path.join(base, "ClipWeave");
  }
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "ClipWeave");
  }
  const base = env.XDG_DATA_HOME || path.join(homeDir, ".local", "share");
  return path.join(base, "clipweave");
}

function resolveWorkspaceDir(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  if (env.CLIPWEAVE_WORKSPACE_DIR && String(env.CLIPWEAVE_WORKSPACE_DIR).trim()) {
    return path.resolve(String(env.CLIPWEAVE_WORKSPACE_DIR).trim());
  }
  const mediaRoot = platform === "darwin" ? path.join(homeDir, "Movies") : path.join(homeDir, "Videos");
  return path.join(mediaRoot, "ClipWeave");
}

const DATA_DIR = resolveDataDir();
const WORKSPACE_CONFIG_FILE = path.join(DATA_DIR, "workspace-config.json");

function getConfiguredWorkspaceDir() {
  try {
    if (fs.existsSync(WORKSPACE_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_FILE, "utf8"));
      if (parsed && typeof parsed.workspaceDir === "string" && parsed.workspaceDir.trim()) {
        return path.resolve(parsed.workspaceDir.trim());
      }
    }
  } catch {
    /* ignore unreadable config and fall back */
  }
  return resolveWorkspaceDir();
}

function workspaceSubdirs(baseDir = getConfiguredWorkspaceDir()) {
  const root = path.resolve(baseDir);
  return {
    root,
    projects: path.join(root, "Projects"),
    recordings: path.join(root, "Recordings"),
    clips: path.join(root, "Clips"),
    exports: path.join(root, "Exports"),
    media: path.join(root, "Media"),
  };
}

async function ensureWorkspaceDirs(baseDir = getConfiguredWorkspaceDir()) {
  const dirs = workspaceSubdirs(baseDir);
  await Promise.all(Object.values(dirs).map((d) => fsp.mkdir(d, { recursive: true })));
  return dirs;
}

function sanitizeFileName(raw, fallback = "clip") {
  let clean = String(raw || "")
    // Strip control characters and cross-platform illegal path characters
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);
  if (!clean || RESERVED_WIN_NAMES.test(clean)) {
    clean = fallback;
  }
  return clean;
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fsp.rename(tmp, filePath);
}

async function getFreeDiskBytes(targetPath = DATA_DIR) {
  try {
    let probePath = path.resolve(targetPath);
    while (!fs.existsSync(probePath)) {
      const parent = path.dirname(probePath);
      if (parent === probePath) break;
      probePath = parent;
    }
    if (typeof fsp.statfs === "function") {
      const st = await fsp.statfs(probePath);
      const bsize = Number(st.bsize) || 4096;
      const bavail = Number(st.bavail) || 0;
      const blocks = Number(st.blocks) || 0;
      return {
        path: probePath,
        freeBytes: bavail * bsize,
        totalBytes: blocks * bsize,
      };
    }
  } catch {
    /* statfs unsupported on this filesystem */
  }
  return null;
}

module.exports = {
  ROOT,
  DATA_DIR,
  WORKSPACE_CONFIG_FILE,
  resolveDataDir,
  resolveWorkspaceDir,
  getConfiguredWorkspaceDir,
  workspaceSubdirs,
  ensureWorkspaceDirs,
  sanitizeFileName,
  atomicWriteJson,
  getFreeDiskBytes,
};
