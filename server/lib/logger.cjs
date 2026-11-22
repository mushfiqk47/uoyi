"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DATA_DIR, ROOT, getConfiguredWorkspaceDir, getFreeDiskBytes } = require("./paths.cjs");

const LOG_DIR = path.join(DATA_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "clipweave.log");
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_ROTATED = 3;

function redactSecrets(input) {
  let s = String(input ?? "");
  s = s.replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED_GEMINI_KEY]");
  s = s.replace(/sk-[0-9A-Za-z\-_]{16,}/g, "[REDACTED_API_KEY]");
  s = s.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[REDACTED_TOKEN]");
  s = s.replace(/("(?:apiKey|token|password|secret|authorization)"\s*:\s*")([^"]*)(")/gi, '$1[REDACTED]$3');
  s = s.replace(/(GEMINI_API_KEY|CLIPWEAVE_AI_KEY|CLIPWEAVE_API_TOKEN)=([^\s]+)/gi, "$1=[REDACTED]");
  s = s.replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[REDACTED]:[REDACTED]@");
  return s;
}

let rotatePromise = null;
async function rotateIfNeeded() {
  if (rotatePromise) return rotatePromise;
  rotatePromise = (async () => {
    try {
      const st = await fsp.stat(LOG_FILE).catch(() => null);
      if (!st || st.size < MAX_LOG_BYTES) return;
      for (let i = MAX_ROTATED - 1; i >= 1; i--) {
        const src = `${LOG_FILE}.${i}`;
        const dst = `${LOG_FILE}.${i + 1}`;
        if (fs.existsSync(src)) await fsp.rename(src, dst).catch(() => {});
      }
      await fsp.rename(LOG_FILE, `${LOG_FILE}.1`).catch(() => {});
    } finally {
      rotatePromise = null;
    }
  })();
  return rotatePromise;
}

function log(level, scope, message, meta) {
  const ts = new Date().toISOString();
  const safeMsg = redactSecrets(message);
  const safeMeta = meta !== undefined ? ` ${redactSecrets(typeof meta === "string" ? meta : JSON.stringify(meta))}` : "";
  const line = `[${ts}] [${String(level || "INFO").toUpperCase()}] [${scope}] ${safeMsg}${safeMeta}\n`;
  if (level === "error") console.error(line.trimEnd());
  if (process.env.NODE_ENV === "test") return;
  void (async () => {
    try {
      await fsp.mkdir(LOG_DIR, { recursive: true });
      await rotateIfNeeded();
      await fsp.appendFile(LOG_FILE, line, "utf8");
    } catch {
      /* logging must never crash the server */
    }
  })();
}

async function readLogTail(maxLines = 150) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const text = await fsp.readFile(LOG_FILE, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(500, maxLines))).map(redactSecrets);
  } catch {
    return [];
  }
}

async function buildDiagnosticsReport(extra = {}) {
  const [dataDisk, workspaceDisk, logTail] = await Promise.all([
    getFreeDiskBytes(DATA_DIR),
    getFreeDiskBytes(getConfiguredWorkspaceDir()),
    readLogTail(150),
  ]);
  let pkgVersion = "0.1.0";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    if (pkg?.version) pkgVersion = String(pkg.version);
  } catch { /* ignore */ }

  return {
    generatedAt: new Date().toISOString(),
    appVersion: pkgVersion,
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      cpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
    },
    paths: {
      dataDir: DATA_DIR,
      workspaceDir: getConfiguredWorkspaceDir(),
      logFile: LOG_FILE,
    },
    disk: {
      data: dataDisk,
      workspace: workspaceDisk,
    },
    ...extra,
    logs: logTail,
  };
}

module.exports = {
  LOG_DIR,
  LOG_FILE,
  redactSecrets,
  log,
  readLogTail,
  buildDiagnosticsReport,
};
