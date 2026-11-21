"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const dns = require("node:dns/promises");
const net = require("node:net");

function isPrivateIp(ip) {
  if (!ip) return true;
  const normalized = ip.replace(/^::ffff:/i, "");
  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const lower = normalized.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:")
  );
}

/** Rejects non-http(s) URLs and loopback/link-local/RFC1918 targets to prevent SSRF. */
async function assertSafePublicUrl(raw) {
  let target;
  try {
    target = new URL(String(raw || ""));
  } catch {
    throw new Error("Invalid URL");
  }
  if (!/^https?:$/.test(target.protocol)) {
    throw new Error("Only http(s) URLs are supported");
  }
  const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local or private network URLs are not allowed");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Private network IP addresses are not allowed");
    return target;
  }
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some((r) => isPrivateIp(r.address))) {
      throw new Error("Resolved address is in a private or reserved network");
    }
  } catch (e) {
    if (e.message.includes("private") || e.message.includes("reserved")) throw e;
    // Let the upstream HTTP request handle ordinary transient DNS errors
  }
  return target;
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", data.length);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(data);
}

function fail(res, status, message) {
  json(res, status, { ok: false, error: message });
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

function pipeStream(stream, res) {
  // Destroy the file descriptor immediately if the client aborts mid-scrub.
  res.on("close", () => stream.destroy());
  stream.on("error", () => {
    if (!res.headersSent) fail(res, 500, "Failed to read file");
    else res.destroy();
  });
  stream.pipe(res);
}

function sendFile(req, res, file, type, extraHeaders = {}) {
  return fsp.stat(file).then((stat) => {
    res.setHeader("Content-Type", type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
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
      pipeStream(fs.createReadStream(file, { start: range.start, end: range.end }), res);
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Length", stat.size);
    pipeStream(fs.createReadStream(file), res);
  });
}

function methodAndPath(req) {
  const url = new URL(req.url, "http://127.0.0.1");
  return { method: req.method || "GET", pathname: url.pathname, query: url.searchParams };
}

module.exports = { json, fail, readBody, readJson, parseRange, sendFile, methodAndPath, isPrivateIp, assertSafePublicUrl };
