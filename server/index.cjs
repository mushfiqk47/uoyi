"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { json, methodAndPath } = require("./lib/http.cjs");
const { handle } = require("./router.cjs");
const { ROOT } = require("./lib/proc.cjs");

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
  const target = path.resolve(dist, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  const rel = path.relative(dist, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, "index.html");
  if (!fs.existsSync(file)) return false;
  res.setHeader("Content-Type", STATIC_TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
  return true;
}

function start() {
  const port = Number(process.env.PORT) || 3000;
  http
    .createServer((req, res) => {
      const { pathname, method } = methodAndPath(req);
      if (pathname.startsWith("/api") || pathname.startsWith("/stream") || pathname.startsWith("/media")) {
        void handle(req, res);
      } else if ((method === "GET" || method === "HEAD") && serveStatic(req, res, pathname)) {
        return;
      } else {
        json(res, 404, { ok: false, error: "Not found" });
      }
    })
    .listen(port, "0.0.0.0", () => {
      console.log(`[clipweave] local API on http://0.0.0.0:${port}`);
    });
}

module.exports = { handle, serveStatic, start, setApiBase() {} };
