"use strict";

const crypto = require("node:crypto");

const SESSION_TOKEN =
  (process.env.CLIPWEAVE_API_TOKEN && String(process.env.CLIPWEAVE_API_TOKEN).trim()) ||
  crypto.randomBytes(32).toString("hex");

function mediaToken() {
  return crypto.createHmac("sha256", SESSION_TOKEN).update("clipweave-media").digest("hex").slice(0, 32);
}

function constantTimeEquals(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (!ba.length || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function hostFromHeaders(req) {
  const xfHost = req.headers["x-forwarded-host"];
  const raw = Array.isArray(xfHost) ? xfHost[0] : xfHost || req.headers.host || "";
  return String(raw).split(",")[0].trim().toLowerCase();
}

function isSameOriginBrowserRequest(req) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = req.headers.origin;
  if (!origin) return true; // non-CORS same-origin GET or native Electron / Node client
  if (origin === "null") return false;

  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }

  const reqHost = hostFromHeaders(req);
  if (!reqHost) return false;
  if (originHost === reqHost) return true;

  // Allow localhost <-> 127.0.0.1 loopback equivalents on the same port
  const [oh, op] = originHost.split(":");
  const [rh, rp] = reqHost.split(":");
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (loopback.has(oh) && loopback.has(rh) && (op || "") === (rp || "")) return true;

  const extra = String(process.env.CLIPWEAVE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(String(origin).toLowerCase());
}

function applySecurityHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const origin = req.headers.origin;
  if (origin && isSameOriginBrowserRequest(req)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
}

function extractedBearer(req) {
  const auth = String(req.headers.authorization || "");
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const header = req.headers["x-clipweave-token"];
  return Array.isArray(header) ? header[0] : String(header || "").trim();
}

function isAuthorized(req, query, pathname) {
  // Bootstrap & health are readable from same-origin app pages without a token yet.
  if (pathname === "/api/auth/bootstrap" || pathname === "/api/health") {
    return isSameOriginBrowserRequest(req);
  }
  const supplied = extractedBearer(req);
  if (supplied && constantTimeEquals(supplied, SESSION_TOKEN)) return true;

  // <video>, <audio>, and download links attach the HMAC media token as ?token=...
  const qToken = query?.get?.("token") || "";
  if (qToken && constantTimeEquals(qToken, mediaToken())) return true;
  if (qToken && constantTimeEquals(qToken, SESSION_TOKEN)) return true;

  return false;
}

module.exports = {
  SESSION_TOKEN,
  mediaToken,
  isSameOriginBrowserRequest,
  applySecurityHeaders,
  isAuthorized,
};
