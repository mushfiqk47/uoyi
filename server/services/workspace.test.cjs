"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

test("workspace service persists projects, media, exports, and AES-256-GCM secret vault", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cw-ws-"));
  const dataDir = path.join(root, "data");
  const wsDir = path.join(root, "workspace");
  process.env.CLIPWEAVE_DATA_DIR = dataDir;
  process.env.CLIPWEAVE_WORKSPACE_DIR = wsDir;

  // Clear module cache so DATA_DIR picks up temp override in test process
  delete require.cache[require.resolve("../lib/paths.cjs")];
  delete require.cache[require.resolve("./workspace.cjs")];

  const ws = require("./workspace.cjs");
  try {
    const savedCfg = await ws.setWorkspaceConfig({ workspaceDir: wsDir, autoSaveExports: true });
    assert.equal(savedCfg.workspaceDir, path.resolve(wsDir));

    const project = { id: "proj-1", title: "Clutch Win", updatedAt: 100 };
    await ws.saveProjectRecord(project);
    assert.equal(ws.listProjects().length, 1);
    assert.equal(ws.getProject("proj-1").title, "Clutch Win");

    const srcFile = path.join(root, "sample.mp4");
    await fsp.writeFile(srcFile, "video-bytes");
    const exported = await ws.copyToWorkspaceExports(srcFile, "Clutch Win", "mp4");
    assert.equal(exported.fileName, "Clutch Win.mp4");
    assert.equal(fs.existsSync(exported.path), true);

    const status1 = await ws.saveSecretsPatch({ gemini: "sk-test-secret-value" });
    assert.equal(status1.gemini, true);
    assert.equal(status1.openai, false);
    assert.equal(ws.getSecret("gemini"), "sk-test-secret-value");

    // Secrets file on disk must be encrypted (plaintext key absent)
    const rawEnc = fs.readFileSync(path.join(dataDir, "secrets.enc.json"), "utf8");
    assert.equal(rawEnc.includes("sk-test-secret-value"), false);

    const status2 = await ws.saveSecretsPatch({ gemini: "" });
    assert.equal(status2.gemini, false);

    const summary = await ws.getWorkspaceSummary();
    assert.equal(summary.dataDir, path.resolve(dataDir));
    assert.equal(summary.dirs.exports, path.join(path.resolve(wsDir), "Exports"));
    assert.equal(summary.counts.projects, 1);

    assert.equal(await ws.deleteProjectRecord("proj-1"), true);
    assert.equal(ws.listProjects().length, 0);
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
