"use strict";

const net = require("node:net");
const dns = require("node:dns").promises;
const path = require("node:path");

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isPrivateIpv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  const inRange = (start, mask) => (n & mask) >>> 0 === start >>> 0;
  return (
    inRange(0x00000000, 0xff000000) || // 0.0.0.0/8 "this network"
    inRange(0x0a000000, 0xff000000) || // 10.0.0.0/8 RFC1918
    inRange(0x64400000, 0xffc00000) || // 100.64.0.0/10 CGNAT
    inRange(0x7f000000, 0xff000000) || // 127.0.0.0/8 loopback
    inRange(0xa9fe0000, 0xffff0000) || // 169.254.0.0/16 link-local / cloud metadata
    inRange(0xac100000, 0xfff00000) || // 172.16.0.0/12 RFC1918
    inRange(0xc0000000, 0xffffff00) || // 192.0.0.0/24 IETF protocol assignments
    inRange(0xc0a80000, 0xffff0000) || // 192.168.0.0/16 RFC1918
    inRange(0xe0000000, 0xf0000000) || // 224.0.0.0/4 multicast
    inRange(0xf0000000, 0xf0000000)    // 240.0.0.0/4 reserved
  );
}

function isPrivateIp(rawIp) {
  const ip = String(rawIp || "").trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return isPrivateIpv4(mapped[1]);
    // ULA fc00::/7 (fc.. / fd..) or link-local fe80::/10 (fe8..feB) or multicast ff00::/8
    if (/^(fc|fd)[0-9a-f]{2}:/.test(ip)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;
    if (/^ff[0-9a-f]{2}:/.test(ip)) return true;
    return false;
  }
  return false;
}

/**
 * Validates an outbound HTTP(S) URL against embedded credentials, bad schemes,
 * and private/loopback/metadata network destinations.
 */
async function validateExternalHttpUrl(rawUrl, opts = {}) {
  const { allowPrivate = false, allowLocalhostOnly = false, resolveDns = true } = opts;
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, error: "Only http(s) URLs are supported" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with embedded credentials are not allowed" };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) {
    return { ok: false, error: "Missing host in URL" };
  }

  const isLoopbackHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (allowLocalhostOnly && isLoopbackHost) {
    return { ok: true, url: parsed };
  }

  if (!allowPrivate) {
    if (
      BLOCKED_HOSTNAMES.has(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return { ok: false, error: "Private or local network URLs are not allowed" };
    }
    if (net.isIP(host) && isPrivateIp(host)) {
      return { ok: false, error: "Private or loopback IP addresses are not allowed" };
    }
    if (resolveDns && !net.isIP(host)) {
      try {
        const records = await dns.lookup(host, { all: true });
        if (records.some((r) => isPrivateIp(r.address))) {
          return { ok: false, error: "URL resolves to a private or loopback address" };
        }
      } catch {
        // Offline / unresolvable hostnames will fail cleanly during outbound fetch.
      }
    }
  }

  return { ok: true, url: parsed };
}

/** Ensures a user-supplied URL path resolves strictly inside `baseDir`. */
function safeResolvedPath(baseDir, pathname) {
  const root = path.resolve(baseDir);
  const rel = String(pathname || "/").replace(/^\/+/, "") || "index.html";
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

module.exports = {
  isPrivateIp,
  validateExternalHttpUrl,
  safeResolvedPath,
};
