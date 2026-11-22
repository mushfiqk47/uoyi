"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  DATA_DIR,
  WORKSPACE_CONFIG_FILE,
  getConfiguredWorkspaceDir,
  workspaceSubdirs,
  ensureWorkspaceDirs,
  sanitizeFileName,
  atomicWriteJson,
  getFreeDiskBytes,
} = require("../lib/paths.cjs");

const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const MEDIA_INDEX_FILE = path.join(DATA_DIR, "media-index.json");
const SECRETS_FILE = path.join(DATA_DIR, "secrets.enc.json");
const KEY_FILE = path.join(DATA_DIR, ".key");

const SECRET_FIELDS = new Set(["gemini", "openai", "cloud", "kilo", "local"]);

let projectsCache = null;
let mediaCache = null;
let configCache = null;
let secretsCache = null;

function loadOrCreateVaultKey() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, "utf8").trim();
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* Windows ACLs ignore chmod */ }
  return key;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getWorkspaceConfig() {
  if (!configCache) {
    const raw = readJsonSafe(WORKSPACE_CONFIG_FILE, {});
    const workspaceDir = getConfiguredWorkspaceDir();
    configCache = {
      workspaceDir,
      autoSaveExports: raw.autoSaveExports !== false,
    };
  }
  return { ...configCache, subdirs: workspaceSubdirs(configCache.workspaceDir) };
}

async function setWorkspaceConfig({ workspaceDir, autoSaveExports } = {}) {
  const current = getWorkspaceConfig();
  const nextDir =
    typeof workspaceDir === "string" && workspaceDir.trim()
      ? path.resolve(workspaceDir.trim())
      : current.workspaceDir;
  // Probe writable directory
  await ensureWorkspaceDirs(nextDir);
  configCache = {
    workspaceDir: nextDir,
    autoSaveExports: typeof autoSaveExports === "boolean" ? autoSaveExports : current.autoSaveExports,
  };
  await atomicWriteJson(WORKSPACE_CONFIG_FILE, {
    workspaceDir: configCache.workspaceDir,
    autoSaveExports: configCache.autoSaveExports,
  });
  return getWorkspaceConfig();
}

function listProjects() {
  if (!projectsCache) {
    const raw = readJsonSafe(PROJECTS_FILE, []);
    projectsCache = Array.isArray(raw) ? raw : [];
  }
  return [...projectsCache].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getProject(id) {
  const target = String(id || "");
  return listProjects().find((p) => p.id === target) || null;
}

async function saveProjectRecord(project) {
  if (!project || typeof project !== "object" || !project.id) {
    throw new Error("Project must include an id.");
  }
  const now = Date.now();
  const list = listProjects();
  const idx = list.findIndex((p) => p.id === project.id);
  const record = {
    ...project,
    title: String(project.title || "Untitled Clip").slice(0, 140),
    createdAt: Number(project.createdAt) || list[idx]?.createdAt || now,
    updatedAt: now,
  };
  if (idx >= 0) list[idx] = record;
  else list.unshift(record);
  projectsCache = list;
  await atomicWriteJson(PROJECTS_FILE, list);
  const dirs = await ensureWorkspaceDirs(getWorkspaceConfig().workspaceDir);
  const safeName = sanitizeFileName(record.title || record.id, "project");
  const snapshotPath = path.join(dirs.projects, `${safeName}-${sanitizeFileName(record.id, "id")}.clipweave.json`);
  await atomicWriteJson(snapshotPath, record).catch(() => {});
  return record;
}

async function deleteProjectRecord(id) {
  const target = String(id || "");
  const list = listProjects();
  const removed = list.find((p) => p.id === target);
  const next = list.filter((p) => p.id !== target);
  if (next.length === list.length) return false;
  projectsCache = next;
  await atomicWriteJson(PROJECTS_FILE, next);
  if (removed) {
    const dirs = workspaceSubdirs(getWorkspaceConfig().workspaceDir);
    const safeName = sanitizeFileName(removed.title || removed.id, "project");
    const snapshotPath = path.join(dirs.projects, `${safeName}-${sanitizeFileName(removed.id, "id")}.clipweave.json`);
    await fsp.rm(snapshotPath, { force: true }).catch(() => {});
  }
  return true;
}

function listWorkspaceMedia() {
  if (!mediaCache) {
    const raw = readJsonSafe(MEDIA_INDEX_FILE, []);
    mediaCache = Array.isArray(raw) ? raw.filter((item) => item && item.id && item.file) : [];
  }
  return mediaCache.filter((item) => fs.existsSync(item.file));
}

function getWorkspaceMedia(id) {
  return listWorkspaceMedia().find((m) => m.id === String(id || "")) || null;
}

async function registerWorkspaceMedia(entry) {
  if (!entry || !entry.id || !entry.file) return null;
  const current = listWorkspaceMedia();
  const idx = current.findIndex((m) => m.id === entry.id);
  const record = {
    id: String(entry.id),
    title: String(entry.title || "Media").slice(0, 140),
    file: path.resolve(entry.file),
    mime: String(entry.mime || "video/mp4"),
    kind: String(entry.kind || "video"),
    source: String(entry.source || "upload"),
    duration: Number(entry.duration) || 0,
    bytes: Number(entry.bytes) || (await fsp.stat(entry.file).then((s) => s.size).catch(() => 0)),
    createdAt: Number(entry.createdAt) || current[idx]?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  if (idx >= 0) current[idx] = record;
  else current.unshift(record);
  mediaCache = current;
  await atomicWriteJson(MEDIA_INDEX_FILE, current);
  return record;
}

async function deleteWorkspaceMedia(id) {
  const target = String(id || "");
  const current = listWorkspaceMedia();
  const found = current.find((m) => m.id === target);
  if (!found) return false;
  mediaCache = current.filter((m) => m.id !== target);
  await atomicWriteJson(MEDIA_INDEX_FILE, mediaCache);
  // Only delete files inside workspace dirs or DATA_DIR, never arbitrary user source paths outside workspace
  const cfg = getWorkspaceConfig();
  const dirs = [cfg.workspaceDir, DATA_DIR].map((d) => path.resolve(d) + path.sep);
  if (dirs.some((prefix) => path.resolve(found.file).startsWith(prefix))) {
    await fsp.rm(found.file, { force: true }).catch(() => {});
  }
  return true;
}

async function copyToWorkspaceExports(srcPath, baseName, ext = "mp4") {
  const dirs = await ensureWorkspaceDirs(getWorkspaceConfig().workspaceDir);
  const safeBase = sanitizeFileName(baseName || "clip", "clip");
  const cleanExt = String(ext || "mp4").replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp4";
  let dest = path.join(dirs.exports, `${safeBase}.${cleanExt}`);
  let n = 2;
  while (fs.existsSync(dest) && n < 500) {
    dest = path.join(dirs.exports, `${safeBase}_${n}.${cleanExt}`);
    n++;
  }
  await fsp.copyFile(srcPath, dest);
  const stat = await fsp.stat(dest).catch(() => null);
  return {
    path: dest,
    fileName: path.basename(dest),
    bytes: stat?.size || 0,
  };
}

function loadSecretsMap() {
  if (secretsCache) return { ...secretsCache };
  try {
    if (!fs.existsSync(SECRETS_FILE)) {
      secretsCache = {};
      return {};
    }
    const payload = JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8"));
    const key = loadOrCreateVaultKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "hex"));
    decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, "hex")), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString("utf8"));
    secretsCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    secretsCache = {};
  }
  return { ...secretsCache };
}

async function saveSecretsPatch(patch) {
  const current = loadSecretsMap();
  for (const [k, v] of Object.entries(patch || {})) {
    if (!SECRET_FIELDS.has(k)) continue;
    const trimmed = String(v ?? "").trim();
    if (!trimmed) delete current[k];
    else current[k] = trimmed;
  }
  const key = loadOrCreateVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(current), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  secretsCache = current;
  await atomicWriteJson(SECRETS_FILE, {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  });
  try { await fsp.chmod(SECRETS_FILE, 0o600); } catch { /* ignore */ }
  return getSecretsStatus();
}

function getSecret(provider) {
  const name = String(provider || "").toLowerCase();
  const map = loadSecretsMap();
  return map[name] || "";
}

function getSecretsStatus() {
  const map = loadSecretsMap();
  const out = {};
  for (const k of SECRET_FIELDS) {
    out[k] = Boolean(map[k] && String(map[k]).trim());
  }
  return out;
}

async function getWorkspaceSummary() {
  const cfg = getWorkspaceConfig();
  const [disk, projects, media] = await Promise.all([
    getFreeDiskBytes(cfg.workspaceDir),
    Promise.resolve(listProjects()),
    Promise.resolve(listWorkspaceMedia()),
  ]);
  return {
    ...cfg,
    dataDir: DATA_DIR,
    dirs: cfg.subdirs,
    disk,
    counts: {
      projects: projects.length,
      media: media.length,
    },
    projectCount: projects.length,
    mediaCount: media.length,
    secretsConfigured: getSecretsStatus(),
  };
}

module.exports = {
  getWorkspaceConfig,
  setWorkspaceConfig,
  getWorkspaceSummary,
  listProjects,
  getProject,
  saveProjectRecord,
  deleteProjectRecord,
  listWorkspaceMedia,
  getWorkspaceMedia,
  registerWorkspaceMedia,
  deleteWorkspaceMedia,
  copyToWorkspaceExports,
  saveSecretsPatch,
  getSecret,
  getSecretsStatus,
};
