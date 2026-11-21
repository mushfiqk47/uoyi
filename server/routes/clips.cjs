"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { json, fail, readJson } = require("../lib/http.cjs");
const { readMultipart, boundaryOf } = require("../lib/multipart.cjs");
const { run, encoderArgs, nvencEnabled, probe } = require("../lib/proc.cjs");
const { tempDir } = require("../lib/files.cjs");
const { id } = require("../lib/id.cjs");
const { mediaJobs, clipFiles } = require("../state.cjs");

async function apiClipFinalize(req, res, query) {
  const boundary = boundaryOf(req);
  if (!boundary) return fail(res, 400, "Expected multipart/form-data");
  const dir = await tempDir("clip-");
  const input = path.join(dir, "input.webm");
  const inPoint = Math.max(0, Number(query.get("in")) || 0);
  const duration = Math.max(0.2, Number(query.get("duration")) || 0);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  };
  res.on("close", cleanup);
  try {
    await readMultipart(req, boundary, {
      onFile() {
        return fs.createWriteStream(input);
      },
      onField() {},
    });
    const out = path.join(dir, "clip.mp4");
    const srcInfo = inPoint === 0 ? await probe(input) : null;
    const args = ["-y", "-hide_banner", "-loglevel", "error"];
    if (inPoint > 0) args.push("-ss", inPoint.toFixed(3));
    args.push("-i", input, "-t", duration.toFixed(3));
    if (inPoint === 0 && srcInfo?.hasVideo && srcInfo.videoCodec === "h264") {
      args.push("-c:v", "copy");
    } else {
      args.push(...(await encoderArgs()));
    }
    if (inPoint === 0 && srcInfo?.hasAudio && srcInfo.audioCodec === "aac") {
      args.push("-c:a", "copy");
    } else {
      args.push("-c:a", "aac", "-b:a", "160k");
    }
    args.push("-movflags", "+faststart", out);
    const r = await run("ffmpeg", args, { timeout: 600000 });
    if (r.code !== 0 || !fs.existsSync(out)) {
      cleanup();
      return fail(res, 500, r.stderr.split("\n").filter(Boolean).slice(-1)[0] || "FFmpeg couldn't finalise that clip.");
    }
    const [info, stat] = await Promise.all([probe(out), fsp.stat(out)]);
    res.statusCode = 200;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("X-Clipweave-Has-Audio", info.hasAudio ? "1" : "0");
    res.setHeader("X-Clipweave-Has-Video", info.hasVideo ? "1" : "0");
    res.setHeader("X-Clipweave-Gpu", nvencEnabled() ? "1" : "0");
    res.setHeader("Access-Control-Allow-Origin", "*");
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(out);
      res.on("close", () => {
        stream.destroy();
        resolve();
      });
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.pipe(res);
    });
  } catch (e) {
    if (!res.headersSent) fail(res, 500, String(e?.message || e || "Finalize failed"));
  } finally {
    cleanup();
  }
}

// Fit the full source inside a 9:16 (1080x1920) frame with a downscaled blurred, darkened background.
const VERTICAL_FIT =
  "[0:v]split=2[bg][fg];" +
  "[bg]scale=180:320:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=180:320,boxblur=4:1,eq=brightness=-0.15,scale=1080:1920:flags=bilinear[bgout];" +
  "[fg]scale=1080:1920:force_original_aspect_ratio=decrease:flags=bilinear[fgout];" +
  "[bgout][fgout]overlay=(W-w)/2:(H-h)/2,setsar=1[v]";

async function apiClipCut(req, res) {
  const { id: mediaId, start, end, title, vertical } = await readJson(req);
  const job = mediaJobs.get(String(mediaId || ""));
  if (!job || job.status !== "ready") return fail(res, 404, "Media isn't ready");
  const from = Math.max(0, Number(start) || 0);
  const to = Math.max(from + 0.5, Number(end) || from + 10);
  const dir = await tempDir("cut-");
  const out = path.join(dir, "cut.mp4");
  const thumb = path.join(dir, "thumb.jpg");
  try {
    const dur = (to - from).toFixed(3);
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-ss", from.toFixed(3), "-i", job.file, "-t", dur];
    if (vertical) {
      args.push("-filter_complex", VERTICAL_FIT, "-map", "[v]", "-map", "0:a?");
    }
    args.push(...(await encoderArgs()));
    args.push("-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out);
    const r = await run("ffmpeg", args, { timeout: 600000 });
    if (r.code !== 0 || !fs.existsSync(out)) return fail(res, 500, "FFmpeg couldn't cut that clip.");
    const mid = (from + (to - from) / 2).toFixed(3);
    if (vertical) {
      await run("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error", "-ss", mid, "-i", job.file, "-frames:v", "1",
        "-filter_complex", VERTICAL_FIT.replace(",setsar=1[v]", ",setsar=1,scale=320:-2[v]"),
        "-map", "[v]", thumb,
      ]);
    } else {
      await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", mid, "-i", job.file, "-frames:v", "1", "-vf", "scale=320:-2", thumb]);
    }
    const clipId = id();
    clipFiles.set(clipId, { id: clipId, file: out, duration: to - from, mime: "video/mp4" });
    let thumbData = null;
    if (fs.existsSync(thumb)) thumbData = `data:image/jpeg;base64,${(await fsp.readFile(thumb)).toString("base64")}`;
    json(res, 200, { id: clipId, url: `/media/clip?id=${clipId}`, duration: to - from, thumb: thumbData, title: title || "" });
  } catch (e) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    fail(res, 500, e.message || "Cut failed");
  } finally {
    fsp.rm(thumb).catch(() => {});
  }
}

module.exports = {
  "POST /api/clip/finalize": apiClipFinalize,
  "POST /api/clip/cut": apiClipCut,
};
