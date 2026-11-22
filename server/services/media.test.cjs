"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  pickPlayable,
  isPermissionError,
  buildYtDlpArgs,
  cleanupMediaPrefix,
} = require("./media.cjs");

test("pickPlayable prefers the highest rendition at or below 1080p", () => {
  const info = {
    formats: [
      { url: "a", vcodec: "avc1", height: 2160 },
      { url: "b", vcodec: "avc1", height: 720 },
      { url: "c", vcodec: "avc1", height: 1080 },
      { url: "d", vcodec: "none", height: 1080 },
    ],
  };
  assert.equal(pickPlayable(info).url, "c");
});

test("pickPlayable falls back to the highest video and then the last format", () => {
  const tall = { formats: [{ url: "only", vcodec: "avc1", height: 1440 }] };
  assert.equal(pickPlayable(tall).url, "only");

  const unlabelled = { formats: [{ url: "one", vcodec: "avc1" }, { url: "two", vcodec: "avc1" }] };
  assert.equal(pickPlayable(unlabelled).url, "two");

  assert.equal(pickPlayable({ formats: [] }), null);
});

test("isPermissionError detects yt-dlp Errno 13 permission denied failures", () => {
  assert.equal(
    isPermissionError(
      "ERROR: unable to open for writing: [Errno 13] Permission denied: '/home/hasan/.local/share/clipweave/cache/media-8748db34065347f0.f398.mp4.part'",
    ),
    true,
  );
  assert.equal(isPermissionError("ERROR: Video unavailable"), false);
});

test("buildYtDlpArgs passes --ffmpeg-location when local ffmpeg is resolved", () => {
  const withLocal = buildYtDlpArgs("/tmp/out.mp4", "https://example.com/v", "/app/bin/ffmpeg");
  assert.ok(withLocal.includes("--ffmpeg-location"));
  assert.equal(withLocal[withLocal.indexOf("--ffmpeg-location") + 1], "/app/bin");

  const withoutLocal = buildYtDlpArgs("/tmp/out.mp4", "https://example.com/v", null);
  assert.equal(withoutLocal.includes("--ffmpeg-location"), false);
});

test("cleanupMediaPrefix removes only matching partial media files", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cw-media-clean-"));
  try {
    const p1 = path.join(dir, "media-abc123.f398.mp4.part");
    const p2 = path.join(dir, "media-abc123.f140-2.m4a.part");
    const keep = path.join(dir, "media-other999.mp4");
    await fsp.writeFile(p1, "1");
    await fsp.writeFile(p2, "2");
    await fsp.writeFile(keep, "3");

    await cleanupMediaPrefix(dir, "abc123");
    assert.equal(fs.existsSync(p1), false);
    assert.equal(fs.existsSync(p2), false);
    assert.equal(fs.existsSync(keep), true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
