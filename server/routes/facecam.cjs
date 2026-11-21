"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { json, fail, readJson } = require("../lib/http.cjs");
const { ROOT, findOpenCvPython } = require("../lib/proc.cjs");
const { hasGeminiKey, detectFacecamWithGemini } = require("../lib/gemini.cjs");

async function apiFacecam(req, res) {
  const body = await readJson(req, 128 * 1024 * 1024);
  if (!body.imageBase64) return fail(res, 400, "No frame image was provided.");

  const script = path.join(ROOT, "scripts", "facecam_detect.py");
  const python = fs.existsSync(script) ? await findOpenCvPython() : null;

  if (python) {
    const r = await new Promise((resolve) => {
      const child = spawn(python, [script], { windowsHide: true, cwd: ROOT });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", (e) => resolve({ code: -1, out, err: String(e.message || e) }));
      child.on("close", (code) => resolve({ code, out, err }));
      child.stdin.end(JSON.stringify({ imageBase64: body.imageBase64, referenceBase64: body.referenceBase64 || null }));
    });
    if (r.code === 0) {
      const start = r.out.indexOf("{");
      if (start >= 0) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(r.out.slice(start));
        return;
      }
    }
  }

  if (hasGeminiKey()) {
    try {
      const result = await detectFacecamWithGemini(body.imageBase64);
      return json(res, 200, result);
    } catch (e) {
      return fail(res, 502, `Gemini facecam detection failed: ${String(e?.message || e)}`);
    }
  }

  return fail(res, 501, "Face detection needs Python with OpenCV or GEMINI_API_KEY configured.");
}

module.exports = { "POST /api/facecam/detect": apiFacecam };
