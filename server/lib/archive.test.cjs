"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { archiveKind, archiveLooksValid, sha256File, verifySha256, extractTarGzNode } = require("./archive.cjs");

function tarHeader(name, size) {
  const buf = Buffer.alloc(512);
  Buffer.from(name, "utf8").copy(buf, 0, 0, 100);
  Buffer.from("0000755\0", "ascii").copy(buf, 100);
  Buffer.from("0000000\0", "ascii").copy(buf, 108);
  Buffer.from("0000000\0", "ascii").copy(buf, 116);
  Buffer.from(`${size.toString(8).padStart(11, "0")}\0`, "ascii").copy(buf, 124);
  Buffer.from("00000000000\0", "ascii").copy(buf, 136);
  buf.fill(0x20, 148, 156);
  buf[156] = "0".charCodeAt(0);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `, "ascii").copy(buf, 148);
  return buf;
}

test("archiveKind recognizes tar.gz, tar.xz, and zip extensions", () => {
  assert.equal(archiveKind("https://example.com/tool.tar.gz?v=1"), "tar.gz");
  assert.equal(archiveKind("ffmpeg.tgz"), "tar.gz");
  assert.equal(archiveKind("ffmpeg-release-amd64-static.tar.xz"), "tar.xz");
  assert.equal(archiveKind("ffmpeg.zip"), "zip");
  assert.equal(archiveKind("yt-dlp"), "unknown");
});

test("archiveLooksValid, sha256File, verifySha256, and extractTarGzNode work end-to-end", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cw-arch-"));
  try {
    const content = Buffer.from("hello-binary");
    const hdr = tarHeader("bin/hello.txt", content.length);
    const pad = Buffer.alloc((512 - (content.length % 512)) % 512);
    const eof = Buffer.alloc(1024);
    const tar = Buffer.concat([hdr, content, pad, eof]);
    const tgzPath = path.join(root, "pack.tar.gz");
    fs.writeFileSync(tgzPath, zlib.gzipSync(tar));

    assert.equal(await archiveLooksValid(tgzPath, "tar.gz"), true);
    assert.equal(await archiveLooksValid(tgzPath, "zip"), false);

    const hash = await sha256File(tgzPath);
    assert.equal(hash.length, 64);
    assert.equal(await verifySha256(tgzPath, hash), true);
    assert.equal(await verifySha256(tgzPath, "0".repeat(64)), false);

    const outDir = path.join(root, "out");
    const count = extractTarGzNode(tgzPath, outDir);
    assert.equal(count, 1);
    assert.equal(fs.readFileSync(path.join(outDir, "bin", "hello.txt"), "utf8"), "hello-binary");
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("extractTarGzNode blocks path traversal entries", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cw-arch-evil-"));
  try {
    const content = Buffer.from("bad");
    const hdr = tarHeader("../escape.txt", content.length);
    const pad = Buffer.alloc((512 - (content.length % 512)) % 512);
    const tar = Buffer.concat([hdr, content, pad, Buffer.alloc(1024)]);
    const tgzPath = path.join(root, "evil.tar.gz");
    fs.writeFileSync(tgzPath, zlib.gzipSync(tar));

    assert.throws(() => extractTarGzNode(tgzPath, path.join(root, "dest")), /unsafe tar entry/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
