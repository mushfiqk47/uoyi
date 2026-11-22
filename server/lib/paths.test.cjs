"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  resolveDataDir,
  resolveWorkspaceDir,
  workspaceSubdirs,
  ensureWorkspaceDirs,
  sanitizeFileName,
  atomicWriteJson,
  getFreeDiskBytes,
} = require("./paths.cjs");

test("resolveDataDir follows OS conventions and CLIPWEAVE_DATA_DIR override", () => {
  assert.equal(resolveDataDir({ CLIPWEAVE_DATA_DIR: "/tmp/cw-custom" }, "linux", "/home/u"), path.resolve("/tmp/cw-custom"));
  const win = resolveDataDir({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u");
  assert.ok(win.endsWith(path.join("Local", "ClipWeave")) || win.includes("ClipWeave"));
  const mac = resolveDataDir({}, "darwin", "/Users/u");
  assert.ok(mac.endsWith(path.join("Library", "Application Support", "ClipWeave")));
  const lin = resolveDataDir({ XDG_DATA_HOME: "/xdg" }, "linux", "/home/u");
  assert.equal(lin, path.join("/xdg", "clipweave"));
});

test("resolveWorkspaceDir respects override and OS media defaults", () => {
  assert.equal(resolveWorkspaceDir({ CLIPWEAVE_WORKSPACE_DIR: "/data/ws" }, "linux", "/home/u"), path.resolve("/data/ws"));
  assert.ok(resolveWorkspaceDir({}, "darwin", "/Users/u").endsWith(path.join("Movies", "ClipWeave")));
  assert.ok(resolveWorkspaceDir({}, "linux", "/home/u").endsWith(path.join("Videos", "ClipWeave")));
});

test("sanitizeFileName strips unsafe chars and Windows reserved names", () => {
  assert.equal(sanitizeFileName("  My: Clip?/Name* "), "My- Clip-Name");
  assert.equal(sanitizeFileName("CON", "fallback"), "fallback");
  assert.equal(sanitizeFileName("lpt1", "clip"), "clip");
  assert.equal(sanitizeFileName("...", "clip"), "clip");
});

test("ensureWorkspaceDirs, atomicWriteJson, and getFreeDiskBytes work on temp workspace", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cw-paths-"));
  try {
    const dirs = await ensureWorkspaceDirs(root);
    assert.deepEqual(Object.keys(workspaceSubdirs(root)), ["root", "projects", "recordings", "clips", "exports", "media"]);
    for (const d of Object.values(dirs)) {
      assert.equal(fs.existsSync(d), true);
    }
    const target = path.join(dirs.projects, "test.json");
    await atomicWriteJson(target, { ok: true, count: 3 });
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { ok: true, count: 3 });
    const disk = await getFreeDiskBytes(root);
    assert.ok(disk === null || disk.freeBytes >= 0);
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
