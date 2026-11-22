"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { json, methodAndPath } = require("./lib/http.cjs");
const { applySecurityHeaders } = require("./lib/auth.cjs");
const { log } = require("./lib/logger.cjs");
const { handle } = require("./router.cjs");
const { ROOT } = require("./lib/proc.cjs");
const { safeResolvedPath } = require("./lib/security.cjs");

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".json": "application/json",
};

function serveStatic(req, res, pathname) {
  const dist = path.resolve(ROOT, "dist");
  const target = safeResolvedPath(dist, pathname);
  if (!target) return false;
  const fallback = path.join(dist, "index.html");
  const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : fallback;
  if (!fs.existsSync(file)) return false;
  applySecurityHeaders(req, res);
  res.setHeader("Content-Type", STATIC_TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
  return true;
}

function defaultHost() {
  if (process.env.CLIPWEAVE_HOST) return process.env.CLIPWEAVE_HOST;
  if (process.env.CLIPWEAVE_LAN === "1" || process.env.PORT) return "0.0.0.0";
  return "127.0.0.1";
}

function start(opts = {}) {
  const port = opts.port !== undefined ? Number(opts.port) : (process.env.PORT !== undefined ? Number(process.env.PORT) : 3000);
  const host = opts.host || defaultHost();
  const server = http.createServer((req, res) => {
    const { pathname, method } = methodAndPath(req);
    if (pathname.startsWith("/api") || pathname.startsWith("/stream") || pathname.startsWith("/media")) {
      void handle(req, res);
    } else if ((method === "GET" || method === "HEAD") && serveStatic(req, res, pathname)) {
      return;
    } else {
      json(res, 404, { ok: false, error: "Not found" }, req);
    }
  });
  server.listen(port, host, () => {
    const addr = server.address();
    const boundPort = typeof addr === "object" && addr ? addr.port : port;
    log("info", "server", `ClipWeave API listening on http://${host}:${boundPort}`);
    console.log(`[clipweave] local API on http://${host}:${boundPort}`);
  });
  return server;
}

module.exports = { handle, serveStatic, start, setApiBase() {} };
