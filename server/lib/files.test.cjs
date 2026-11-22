"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  isHiddenHomePath,
  isDirWritable,
  cacheCandidates,
  ensureCache,
} = require("./files.cjs");
const { isSandboxedLinuxBinary } = require("./proc.cjs");

test("isHiddenHomePath flags dot-directories under home and allows non-hidden paths", () => {
  assert.equal(isHiddenHomePath("/home/hasan/.local/share/clipweave/cache", "/home/hasan"), true);
  assert.equal(isHiddenHomePath("/home/hasan/.cache/clipweave", "/home/hasan"), true);
  assert.equal(isHiddenHomePath("/home/hasan/Videos/ClipWeave/Cache", "/home/hasan"), false);
  assert.equal(isHiddenHomePath("/tmp/clipweave-cache", "/home/hasan"), false);
});

test("cacheCandidates puts non-hidden directories first when avoidHiddenHome is true", () => {
  const list = cacheCandidates({ avoidHiddenHome: true });
  const hiddenIdx = list.findIndex((p) => isHiddenHomePath(p));
  const nonHiddenIdx = list.findIndex((p) => !isHiddenHomePath(p));
  if (hiddenIdx >= 0 && nonHiddenIdx >= 0) {
    assert.ok(nonHiddenIdx < hiddenIdx, `expected non-hidden path before hidden path in ${JSON.stringify(list)}`);
  }
});

test("ensureCache verifies writability and skips excluded directories", async () => {
  const dir = await ensureCache({ doNotCacheSelection: true });
  assert.equal(await isDirWritable(dir), true);

  const next = await ensureCache({ exclude: [dir], doNotCacheSelection: true });
  assert.notEqual(path.resolve(next), path.resolve(dir));
  assert.equal(await isDirWritable(next), true);

  if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {
    const ro = await fsp.mkdtemp(path.join(os.tmpdir(), "cw-ro-"));
    try {
      await fsp.chmod(ro, 0o555);
      assert.equal(await isDirWritable(ro), false);
    } finally {
      await fsp.chmod(ro, 0o755).catch(() => {});
      await fsp.rm(ro, { recursive: true, force: true }).catch(() => {});
    }
  }
});

test("isSandboxedLinuxBinary identifies Snap and Flatpak binaries on Linux", () => {
  assert.equal(isSandboxedLinuxBinary("/snap/bin/yt-dlp", "linux"), true);
  assert.equal(isSandboxedLinuxBinary("/var/lib/snapd/snap/bin/ffmpeg", "linux"), true);
  assert.equal(isSandboxedLinuxBinary("/app/bin/yt-dlp", "linux"), true);
  assert.equal(isSandboxedLinuxBinary("/usr/bin/yt-dlp", "linux"), false);
  assert.equal(isSandboxedLinuxBinary("/snap/bin/yt-dlp", "darwin"), false);
  assert.equal(fs.existsSync(__filename), true);
});
