"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ytDlpAssetName, findFileInTree, localToolPath, setupStatus } = require("./tools.cjs");
const { runtimeAssetCandidates } = require("./audiocpp.cjs");

test("yt-dlp asset covers every supported platform and arch", () => {
  assert.equal(ytDlpAssetName("win32", "x64"), "yt-dlp.exe");
  assert.equal(ytDlpAssetName("darwin", "arm64"), "yt-dlp_macos");
  assert.equal(ytDlpAssetName("darwin", "x64"), "yt-dlp_macos");
  assert.equal(ytDlpAssetName("linux", "x64"), "yt-dlp_linux");
  assert.equal(ytDlpAssetName("linux", "arm64"), "yt-dlp_linux_aarch64");
});

test("audio.cpp runtime asset selection covers Windows, macOS, and Linux", () => {
  assert.deepEqual(runtimeAssetCandidates("win32", "x64"), ["bin-windows-x64-cpu-portable.zip"]);
  assert.deepEqual(runtimeAssetCandidates("darwin", "arm64"), ["bin-macos-arm64-metal.tar.gz"]);
  assert.deepEqual(runtimeAssetCandidates("darwin", "x64"), ["bin-macos-x64-metal.tar.gz"]);
  assert.deepEqual(runtimeAssetCandidates("linux", "x64"), ["bin-ubuntu-x64-cpu-portable.tar.gz"]);
  // arm64 Linux falls back to the x64 portable build (works via emulation or the package manager).
  assert.deepEqual(runtimeAssetCandidates("linux", "arm64"), ["bin-ubuntu-arm64-cpu-portable.tar.gz", "bin-ubuntu-x64-cpu-portable.tar.gz"]);
});

test("localToolPath appends .exe only on Windows", () => {
  const win = localToolPath("ffmpeg");
  const unix = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  assert.ok(win.endsWith(unix));
  assert.ok(win.includes("bin"));
});

test("findFileInTree locates binaries in nested archives", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tools-tree-"));
  try {
    await fsp.mkdir(path.join(root, "ffmpeg-8.0-essentials_build", "bin"), { recursive: true });
    await fsp.writeFile(path.join(root, "ffmpeg-8.0-essentials_build", "bin", "ffmpeg.exe"), "x");
    await fsp.writeFile(path.join(root, "ffmpeg-8.0-essentials_build", "bin", "ffprobe.exe"), "x");
    await fsp.writeFile(path.join(root, "README.txt"), "x");
    const hits = await findFileInTree(root, (f) => f.toLowerCase() === "ffmpeg.exe");
    assert.equal(hits.length, 1);
    assert.ok(hits[0].includes(path.join("ffmpeg-8.0-essentials_build", "bin")));
    assert.equal((await findFileInTree(root, (f) => f === "missing.exe")).length, 0);
  } finally {
    fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("setupStatus includes quality enhancements (streamlink, scenedetect, opencv) in required tier", async () => {
  const { items } = await setupStatus();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of ["ffmpeg", "streamlink", "scenedetect", "opencv"]) {
    const item = byId.get(id);
    assert.ok(item, `missing setup item ${id}`);
    assert.equal(item.tier, "required");
    assert.equal(item.required, true);
  }
});
