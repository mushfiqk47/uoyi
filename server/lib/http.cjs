"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");

const { applySecurityHeaders } = require("./auth.cjs");

function json(res, status, body, req) {
  const data = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", data.length);
  res.setHeader("Cache-Control", "no-store");
  if (req) applySecurityHeaders(req, res);
  else {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
  }
  res.end(data);
}

function fail(res, status, message, code, req) {
  json(res, status, code ? { ok: false, error: message, code } : { ok: false, error: message }, req);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new Error("Expected a JSON body");
  }
}

/** Parses a single `bytes=` range. Returns null when absent, `{ invalid: true }` when the
 *  range cannot be served. Kept separate from sendFile so it can be tested without sockets. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end, length: end - start + 1 };
}

function streamFileToResponse(req, res, file, opts) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(file, opts);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      } else {
        res.destroy();
      }
      finish();
    });
    res.on("finish", finish);
    res.on("close", () => {
      stream.destroy();
      finish();
    });
    req.on("aborted", () => {
      stream.destroy();
      finish();
    });
    stream.pipe(res);
  });
}

async function sendFile(req, res, file, type, extraHeaders = {}) {
  const stat = await fsp.stat(file);
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  applySecurityHeaders(req, res);
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);

  const range = parseRange(req.headers.range, stat.size);
  if (range) {
    if (range.invalid) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader("Content-Length", range.length);
    await streamFileToResponse(req, res, file, { start: range.start, end: range.end });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", stat.size);
  await streamFileToResponse(req, res, file);
}

function methodAndPath(req) {
  const url = new URL(req.url, "http://127.0.0.1");
  return { method: req.method || "GET", pathname: url.pathname, query: url.searchParams };
}

module.exports = { json, fail, readJson, parseRange, sendFile, methodAndPath };
