"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

function archiveKind(nameOrUrl) {
  const lower = String(nameOrUrl || "").toLowerCase().split("?")[0];
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) return "tar.xz";
  if (lower.endsWith(".zip")) return "zip";
  return "unknown";
}

async function archiveLooksValid(filePath, kind = archiveKind(filePath)) {
  try {
    const st = await fsp.stat(filePath);
    if (st.size < 22) return false;
    const fh = await fsp.open(filePath, "r");
    try {
      if (kind === "zip") {
        const tailLen = Math.min(65557, st.size);
        const buf = Buffer.alloc(tailLen);
        await fh.read(buf, 0, tailLen, st.size - tailLen);
        for (let i = tailLen - 22; i >= 0; i--) {
          if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return true;
        }
        return false;
      }
      const head = Buffer.alloc(Math.min(16, st.size));
      await fh.read(head, 0, head.length, 0);
      if (kind === "tar.gz") {
        return head[0] === 0x1f && head[1] === 0x8b;
      }
      if (kind === "tar.xz") {
        return head[0] === 0xfd && head[1] === 0x37 && head[2] === 0x7a && head[3] === 0x58 && head[4] === 0x5a && head[5] === 0x00;
      }
      return st.size > 0;
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifySha256(filePath, expectedHex) {
  if (!expectedHex) return true;
  const actual = await sha256File(filePath);
  return actual.toLowerCase() === String(expectedHex).trim().toLowerCase();
}

function readTarString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul >= 0 ? nul : len).toString("utf8");
}

function readTarOctal(buf, start, len) {
  const s = readTarString(buf, start, len).trim();
  if (!s) return 0;
  return parseInt(s, 8) || 0;
}

/**
 * Pure-Node .tar.gz extractor (gunzip + POSIX ustar headers) with strict path-traversal
 * confinement. Avoids requiring external GNU tar on minimal containers/OSes.
 */
function extractTarGzNode(gzPath, destDir) {
  const root = path.resolve(destDir);
  const gzBuf = fs.readFileSync(gzPath);
  const tar = zlib.gunzipSync(gzBuf);
  let offset = 0;
  let count = 0;
  let longName = null;

  while (offset + 512 <= tar.length) {
    const hdr = tar.subarray(offset, offset + 512);
    offset += 512;
    if (hdr.every((b) => b === 0)) break;

    const rawName = readTarString(hdr, 0, 100);
    const prefix = readTarString(hdr, 345, 155);
    const mode = readTarOctal(hdr, 100, 8);
    const size = readTarOctal(hdr, 124, 12);
    const typeFlag = String.fromCharCode(hdr[156] || 48);

    const dataBlocks = Math.ceil(size / 512) * 512;
    const data = tar.subarray(offset, offset + size);
    offset += dataBlocks;

    // GNU tar long filename extension ('L')
    if (typeFlag === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }

    const relName = longName || (prefix ? `${prefix}/${rawName}` : rawName);
    longName = null;
    if (!relName || typeFlag === "x" || typeFlag === "g") continue;

    const outPath = path.resolve(root, relName);
    if (outPath !== root && !outPath.startsWith(root + path.sep)) {
      throw new Error(`unsafe tar entry: ${relName}`);
    }

    if (typeFlag === "5" || relName.endsWith("/")) {
      fs.mkdirSync(outPath, { recursive: true });
    } else if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, data);
      if (process.platform !== "win32" && mode) {
        fs.chmodSync(outPath, mode & 0o777);
      }
      count++;
    }
  }
  return count;
}

module.exports = {
  archiveKind,
  archiveLooksValid,
  sha256File,
  verifySha256,
  extractTarGzNode,
};
