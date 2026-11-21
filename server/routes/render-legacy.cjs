"use strict";

// Fast FFmpeg native timeline rendering + legacy frame-upload endpoints.
// The browser renderer in src/lib/render.ts uses POST /api/render/native?async=1
// when server FFmpeg is available, falling back to browser Canvas+MediaRecorder otherwise.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { json, fail, readJson, sendFile } = require("../lib/http.cjs");
const { readMultipart, boundaryOf } = require("../lib/multipart.cjs");
const { run, encoderArgs, probe, ROOT } = require("../lib/proc.cjs");
const { tempDir } = require("../lib/files.cjs");
const { id } = require("../lib/id.cjs");

const FONTS_DIR = path.join(ROOT, "public", "fonts");

const renders = new Map(); // legacy frame session id -> session
const nativeJobs = new Map(); // native render id -> job state
const RENDER_TTL = 60 * 60 * 1000;

const renderTimer = setInterval(() => {
  const cutoff = Date.now() - RENDER_TTL;
  for (const [key, session] of renders) {
    if (session.at < cutoff) {
      renders.delete(key);
      fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  for (const [key, job] of nativeJobs) {
    if (job.at < cutoff && job.status !== "rendering") {
      nativeJobs.delete(key);
      fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 10 * 60 * 1000);
renderTimer.unref?.();

const clampNumber = (value, lo, hi, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Encodes `f%06d.jpg` frames in `dir` with the optional WAV. */
async function encodeFrames(dir, spec, audioPath) {
  const out = path.join(dir, `out.${spec.format}`);
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(spec.fps),
    "-i", path.join(dir, "f%06d.jpg"),
  ];
  const hasAudio = audioPath && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 44;
  if (hasAudio) args.push("-i", audioPath);
  if (spec.format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-crf", "24", "-b:v", "0", "-pix_fmt", "yuv420p");
    if (hasAudio) args.push("-c:a", "libopus", "-b:a", "192k", "-shortest");
  } else {
    args.push(...(await encoderArgs({ preset: "faster", crf: 17 })), "-g", String(spec.fps * 2), "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709");
    if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
    args.push("-movflags", "+faststart");
  }
  args.push("-vsync", "cfr", "-s", `${Math.round(spec.width / 2) * 2}x${Math.round(spec.height / 2) * 2}`, out);
  const r = await run("ffmpeg", args, { timeout: 0 });
  if (r.code !== 0 || !fs.existsSync(out)) {
    return { err: r.stderr.split("\n").filter(Boolean).slice(-2).join(" ") || "FFmpeg failed" };
  }
  return { out };
}

async function apiRenderStart(req, res) {
  const body = await readJson(req, 1024 * 1024);
  const dir = await tempDir("render-");
  const session = {
    id: id(),
    dir,
    fps: Math.round(clampNumber(body.fps, 1, 120, 60)),
    width: Math.round(clampNumber(body.width, 2, 4096, 1080)),
    height: Math.round(clampNumber(body.height, 2, 8192, 1920)),
    format: body.format === "webm" ? "webm" : "mp4",
    duration: clampNumber(body.duration, 0, 3600, 0),
    frames: 0,
    at: Date.now(),
  };
  renders.set(session.id, session);
  json(res, 200, { id: session.id });
}

function renderSession(query) {
  return renders.get(query.get("id") || "");
}

async function apiRenderFrames(req, res, query) {
  const session = renderSession(query);
  if (!session) return fail(res, 404, "Unknown render session. Start the render again.");
  const boundary = boundaryOf(req);
  if (!boundary) return fail(res, 400, "Expected multipart/form-data");
  let added = 0;
  await readMultipart(req, boundary, {
    onFile({ name, filename }) {
      if (name !== "frames") return fs.createWriteStream(path.join(session.dir, "ignored.bin"));
      const safe = /^f\d+\.jpg$/i.test(filename || "") ? filename : `f${String(session.frames + added).padStart(6, "0")}.jpg`;
      added++;
      return fs.createWriteStream(path.join(session.dir, safe));
    },
    onField() {},
  });
  session.frames += added;
  session.at = Date.now();
  json(res, 200, { frames: session.frames });
}

async function apiRenderFinish(req, res, query) {
  const session = renderSession(query);
  if (!session) return fail(res, 404, "Unknown render session. Start the render again.");
  const boundary = boundaryOf(req);
  let audioPath = null;
  if (boundary) {
    await readMultipart(req, boundary, {
      onFile() {
        audioPath = path.join(session.dir, "audio.wav");
        return fs.createWriteStream(audioPath);
      },
      onField() {},
    });
  }
  if (!session.frames) return fail(res, 400, "No frames were uploaded");
  const { out, err } = await encodeFrames(session.dir, session, audioPath);
  if (!out) return fail(res, 500, err);
  renders.delete(session.id);
  await sendFile(req, res, out, session.format === "webm" ? "video/webm" : "video/mp4");
  res.on("close", () => fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {}));
}

function apiRenderAbort(_req, res, query) {
  const session = renderSession(query);
  if (session) {
    renders.delete(session.id);
    fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {});
  }
  json(res, 200, { ok: true });
}

async function apiRender(req, res) {
  const boundary = boundaryOf(req);
  if (!boundary) return fail(res, 400, "Expected multipart/form-data");
  const dir = await tempDir("render-");
  const fields = {};
  let audioPath = null;
  let frames = 0;
  let index = 0;

  try {
    await readMultipart(req, boundary, {
      onFile({ name, filename }) {
        if (name === "frames") {
          const safe = /^f\d+\.jpg$/i.test(filename || "") ? filename : `f${String(index).padStart(6, "0")}.jpg`;
          index++;
          frames++;
          return fs.createWriteStream(path.join(dir, safe));
        }
        const target = path.join(dir, "audio.wav");
        audioPath = target;
        return fs.createWriteStream(target);
      },
      onField(name, value) {
        fields[name] = value;
      },
    });

    if (!frames) return fail(res, 400, "No frames were uploaded");
    const spec = {
      fps: Math.round(clampNumber(fields.fps, 1, 120, 60)),
      width: Math.round(clampNumber(fields.width, 2, 4096, 1080)),
      height: Math.round(clampNumber(fields.height, 2, 8192, 1920)),
      format: fields.format === "webm" ? "webm" : "mp4",
    };
    const { out, err } = await encodeFrames(dir, spec, audioPath);
    if (!out) return fail(res, 500, err);
    await sendFile(req, res, out, spec.format === "webm" ? "video/webm" : "video/mp4");
  } finally {
    res.on("close", () => { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  }
}

function atempoFilters(speed) {
  const filters = [];
  let value = Math.max(0.25, Math.min(4, Number(speed) || 1));
  while (value < 0.5) {
    filters.push("atempo=0.5");
    value *= 2;
  }
  while (value > 2) {
    filters.push("atempo=2");
    value /= 2;
  }
  filters.push(`atempo=${value.toFixed(6)}`);
  return filters;
}

function assTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const whole = Math.floor(value % 60);
  const centiseconds = Math.floor((value - Math.floor(value)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function assColor(value, fallback) {
  const hex = /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).slice(1) : fallback;
  return `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
}

function assFontName(font) {
  if (font === "bebas") return "Bebas Neue";
  if (font === "tiktok") return "Clipweave TikTok Sans SemiBold";
  return "Arial";
}

function assText(value) {
  return String(value || "").replace(/[\\{}]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\N");
}

function filterPath(file) {
  return file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function writeOverlayAss(dir, project, width = 1080, height = 1920) {
  const words = Array.isArray(project.captions) ? project.captions.filter((word) => Number(word.end) > Number(word.start)) : [];
  const texts = Array.isArray(project.texts) ? project.texts.filter((t) => Number(t.end) > Number(t.start) && String(t.text || "").trim()) : [];
  if (!words.length && !texts.length) return null;

  const style = project.captionStyle || {};
  const pages = [];
  let page = [];
  const perLine = Math.max(1, Number(style.wordsPerLine) || 3);
  for (const word of [...words].sort((a, b) => Number(a.start) - Number(b.start))) {
    const previous = page[page.length - 1];
    if (page.length >= perLine || (previous && Number(word.start) - Number(previous.end) > 0.6)) {
      pages.push(page);
      page = [];
    }
    page.push(word);
  }
  if (page.length) pages.push(page);

  const font = assFontName(style.font);
  const k = width / 1080;
  const fontSize = Math.max(8, Math.round((Number(style.size) || 112) * k));
  // In split mode the game sits on top; keep captions inside the game area, matching the editor preview.
  const splitShare = project.layout?.mode === "split" ? 1 - clampNumber(project.layout?.facecamShare, 0.15, 0.7, 0.3) : 1;
  const y = Math.round(Math.max(0, Math.min(1, Number(style.y) ?? 0.7)) * splitShare * height);
  const xMid = Math.round(width / 2);
  const borderStyle = style.background ? 3 : 1;
  const outline = style.background ? 14 : style.stroke ? Math.max(3, Math.round(fontSize * 0.1)) : 0;

  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 1",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${font},${fontSize},${assColor(style.highlight, "38bdf8")},${assColor(style.color, "ffffff")},&H00000000,&HB8000000,${style.font === "bebas" ? 0 : -1},0,0,0,100,100,0,0,${borderStyle},${outline},0,5,40,40,0,1`,
    `Style: TextOverlay,Bebas Neue,${Math.round(92 * k)},&H0015CCFA,&H0015CCFA,&H00000000,&HB8000000,0,0,0,0,100,100,0,0,1,6,0,5,40,40,0,1`,
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  for (const current of pages) {
    const start = Number(current[0].start) || 0;
    const end = Number(current[current.length - 1].end) || start + 0.05;
    const text = current
      .map((word) => `{\\kf${Math.max(1, Math.round((Number(word.end) - Number(word.start)) * 100))}}${assText(style.caps ? String(word.text).toUpperCase() : word.text)}`)
      .join(" ");
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,{\\an5\\pos(${xMid},${y})}${text}`);
  }

  for (const t of texts) {
    const start = Math.max(0, Number(t.start) || 0);
    const end = Math.max(start + 0.05, Number(t.end) || start + 3);
    const tx = Math.round(clampNumber(t.x, 0.05, 0.95, 0.5) * width);
    const ty = Math.round(clampNumber(t.y, 0.05, 0.95, 0.2) * height);
    const ts = Math.max(12, Math.round(clampNumber(t.size, 12, 240, 88) * k));
    const tf = assFontName(t.font);
    const tc = assColor(t.color, "facc15");
    const bord = t.background ? 14 : t.stroke ? Math.max(2, Math.round(ts * 0.1)) : 0;
    const bgTag = t.background ? `\\3c&H000000&\\3a&H48&` : "";
    lines.push(
      `Dialogue: 1,${assTime(start)},${assTime(end)},TextOverlay,,0,0,0,,{\\an5\\pos(${tx},${ty})\\fn${tf}\\fs${ts}\\c${tc}\\bord${bord}${bgTag}}${assText(t.text)}`,
    );
  }

  const file = path.join(dir, "captions.ass");
  await fsp.writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function buildClipLayoutFilter(inPad, outPad, idx, layout, width, height, fps) {
  const mode = layout?.mode || "fill";
  const z = clampNumber(layout?.zoom, 0.5, 4, 1);
  const px = clampNumber(layout?.panX, -1, 1, 0);
  const py = clampNumber(layout?.panY, -1, 1, 0);

  if (mode === "fit") {
    const fgW = Math.max(2, Math.round((width * z) / 2) * 2);
    const fgH = Math.max(2, Math.round((height * z) / 2) * 2);
    const ox = `(W-w)/2+(${(px * width * 0.5).toFixed(1)})`;
    const oy = `(H-h)/2+(${(py * height * 0.5).toFixed(1)})`;
    return (
      `[${inPad}]split=2[bg${idx}][fg${idx}];` +
      `[bg${idx}]scale=135:240:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=135:240,boxblur=4:1,eq=brightness=-0.15,scale=${width}:${height}:flags=bilinear[bgo${idx}];` +
      `[fg${idx}]scale=${fgW}:${fgH}:force_original_aspect_ratio=decrease:flags=lanczos[fgo${idx}];` +
      `[bgo${idx}][fgo${idx}]overlay=${ox}:${oy},setsar=1,fps=${fps}[${outPad}]`
    );
  }

  if (mode === "split") {
    // Game on top, facecam below. camH is the facecam's share of the frame height.
    const camH = Math.max(4, Math.min(height - 4, Math.round((height * clampNumber(layout?.facecamShare, 0.15, 0.7, 0.3)) / 2) * 2));
    const mainH = height - camH;
    const fc = layout?.facecam || { x: 0.68, y: 0.04, w: 0.3, h: 0.3 };
    const fx = clampNumber(fc.x, 0, 0.95, 0.68).toFixed(4);
    const fy = clampNumber(fc.y, 0, 0.95, 0.04).toFixed(4);
    const fw = clampNumber(fc.w, 0.05, 1, 0.3).toFixed(4);
    const fh = clampNumber(fc.h, 0.05, 1, 0.3).toFixed(4);
    return (
      `[${inPad}]split=2[cam${idx}][main${idx}];` +
      `[cam${idx}]crop='max(2,trunc(iw*${fw}/2)*2)':'max(2,trunc(ih*${fh}/2)*2)':'max(0,min(iw-ow,trunc(iw*${fx})))':'max(0,min(ih-oh,trunc(ih*${fy})))',` +
      `scale='trunc(max(${width},iw*${camH}/ih)/2)*2':'trunc(max(${camH},ih*${width}/iw)/2)*2':flags=lanczos,crop=${width}:${camH},drawbox=x=0:y=0:w=${width}:h=2:color=black@0.6:t=fill,setsar=1[camo${idx}];` +
      `[main${idx}]scale='trunc(max(${width}*${z},iw*${mainH}*${z}/ih)/2)*2':'trunc(max(${mainH}*${z},ih*${width}*${z}/iw)/2)*2':flags=lanczos,` +
      `pad='max(iw,${width})':'max(ih,${mainH})':(ow-iw)/2:(oh-ih)/2:black,` +
      `crop=${width}:${mainH}:'max(0,min(iw-${width},(iw-${width})/2+(${px.toFixed(4)})*(iw-${width})/2))':'max(0,min(ih-${mainH},(ih-${mainH})/2+(${py.toFixed(4)})*(ih-${mainH})/2))',setsar=1[maino${idx}];` +
      `[maino${idx}][camo${idx}]vstack=inputs=2,setsar=1,fps=${fps}[${outPad}]`
    );
  }

  // Default: fill
  if (Math.abs(z - 1) < 0.001 && Math.abs(px) < 0.001 && Math.abs(py) < 0.001) {
    return `[${inPad}]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,setsar=1,fps=${fps}[${outPad}]`;
  }
  return (
    `[${inPad}]scale='trunc(max(${width}*${z},iw*${height}*${z}/ih)/2)*2':'trunc(max(${height}*${z},ih*${width}*${z}/iw)/2)*2':flags=lanczos,` +
    `pad='max(iw,${width})':'max(ih,${height})':(ow-iw)/2:(oh-ih)/2:black,` +
    `crop=${width}:${height}:'max(0,min(iw-${width},(iw-${width})/2+(${px.toFixed(4)})*(iw-${width})/2))':'max(0,min(ih-${height},(ih-${height})/2+(${py.toFixed(4)})*(ih-${height})/2))',setsar=1,fps=${fps}[${outPad}]`
  );
}

async function prepareNativeFfmpegRun(dir, project, mediaFiles, { width, height, fps, format }) {
  const clips = Array.isArray(project.video) ? project.video : [];
  if (!clips.length) throw new Error("Native render requires at least one video clip");

  const mediaList = Array.isArray(project.media) ? project.media : [];
  const musicList = Array.isArray(project.music) ? project.music : [];
  const probedCache = new Map();
  const getProbe = async (file) => {
    if (!probedCache.has(file)) probedCache.set(file, await probe(file));
    return probedCache.get(file);
  };

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1"];
  const filters = [];
  const vOutPads = [];
  const aOutPads = [];
  let totalDuration = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const filePath = mediaFiles.get(clip.mediaId) || mediaFiles.get("default");
    if (!filePath || !fs.existsSync(filePath)) throw new Error(`Missing media file for clip ${clip.mediaId}`);
    const mediaMeta = mediaList.find((m) => m.id === clip.mediaId);
    const info = await getProbe(filePath);
    const isImage = mediaMeta?.kind === "image" || (!info.duration && info.hasVideo);
    if (!info.hasVideo) throw new Error("The source has no readable video track");

    const start = Math.max(0, Number(clip.in) || 0);
    const end = Math.max(start + 0.05, Number(clip.out) || start + 0.05);
    const speed = isImage ? 1 : clampNumber(clip.speed, 0.25, 4, 1);
    const rawDur = end - start;
    const outDur = rawDur / speed;
    totalDuration += outDur;

    if (isImage) {
      args.push("-loop", "1", "-t", outDur.toFixed(3), "-i", filePath);
    } else {
      if (start > 0.01) args.push("-ss", start.toFixed(3));
      args.push("-t", rawDur.toFixed(3), "-i", filePath);
    }

    const vIn = `vs${i}`;
    const vOut = `vc${i}`;
    filters.push(`[${i}:v]setpts=${Math.abs(speed - 1) > 0.001 ? `(PTS-STARTPTS)/${speed.toFixed(6)}` : "PTS-STARTPTS"}[${vIn}]`);
    filters.push(buildClipLayoutFilter(vIn, vOut, i, project.layout, width, height, fps));
    vOutPads.push(`[${vOut}]`);

    // Match playback.ts audio-lane override for mirrored video sound
    const mirrored = musicList.find((m) => m.mediaId === clip.mediaId && m.auto);
    const vol = clampNumber(mirrored ? mirrored.volume : clip.volume, 0, 2, 1);
    if (!isImage && info.hasAudio && vol > 0.001) {
      filters.push(
        `[${i}:a]asetpts=PTS-STARTPTS,${atempoFilters(speed).join(",")},volume=${vol.toFixed(3)},aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo[ac${i}]`,
      );
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${outDur.toFixed(3)},asetpts=PTS-STARTPTS[ac${i}]`);
    }
    aOutPads.push(`[ac${i}]`);
  }

  let videoPad = vOutPads.length === 1 ? "vc0" : "vconcat";
  let audioPad = aOutPads.length === 1 ? "ac0" : "aconcat";
  if (vOutPads.length > 1) {
    filters.push(`${vOutPads.join("")}concat=n=${vOutPads.length}:v=1:a=0[${videoPad}]`);
    filters.push(`${aOutPads.join("")}concat=n=${aOutPads.length}:v=0:a=1[${audioPad}]`);
  }

  // Extra non-mirrored audio tracks (music)
  const extraMusic = musicList.filter((m) => !m.auto && (mediaFiles.has(m.mediaId) || mediaFiles.has("default")));
  let inputIdx = clips.length;
  const mixPads = [`[${audioPad}]`];
  for (let k = 0; k < extraMusic.length; k++) {
    const m = extraMusic[k];
    const filePath = mediaFiles.get(m.mediaId);
    if (!filePath || !fs.existsSync(filePath)) continue;
    const info = await getProbe(filePath);
    if (!info.hasAudio) continue;
    const mIn = Math.max(0, Number(m.in) || 0);
    const mOut = Math.max(mIn + 0.05, Number(m.out) || mIn + 0.05);
    const mDur = mOut - mIn;
    const delayMs = Math.max(0, Math.round((Number(m.start) || 0) * 1000));
    const vol = clampNumber(m.volume, 0, 2, 1);
    if (mIn > 0.01) args.push("-ss", mIn.toFixed(3));
    args.push("-t", mDur.toFixed(3), "-i", filePath);
    filters.push(
      `[${inputIdx}:a]asetpts=PTS-STARTPTS,volume=${vol.toFixed(3)},aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[am${k}]`,
    );
    mixPads.push(`[am${k}]`);
    inputIdx++;
  }
  if (mixPads.length > 1) {
    filters.push(`${mixPads.join("")}amix=inputs=${mixPads.length}:duration=first:normalize=0[amixed]`);
    audioPad = "amixed";
  }

  const assFile = await writeOverlayAss(dir, project, width, height);
  if (assFile) {
    const fDir = fs.existsSync(FONTS_DIR) ? `:fontsdir='${filterPath(FONTS_DIR)}'` : "";
    filters.push(`[${videoPad}]subtitles='${filterPath(assFile)}'${fDir},format=yuv420p[vfinal]`);
    videoPad = "vfinal";
  } else {
    filters.push(`[${videoPad}]format=yuv420p[vfinal]`);
    videoPad = "vfinal";
  }

  const out = path.join(dir, `out.${format}`);
  args.push("-filter_complex", filters.join(";"), "-map", `[${videoPad}]`, "-map", `[${audioPad}]`, "-r", String(fps), "-vsync", "cfr");

  if (format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-crf", "24", "-b:v", "0", "-c:a", "libopus", "-b:a", "192k");
  } else {
    args.push(
      ...(await encoderArgs({ preset: "faster", crf: 17 })),
      "-g",
      String(fps * 2),
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
    );
  }
  args.push("-t", totalDuration.toFixed(3), out);

  return { args, out, totalDuration };
}

/**
 * Fast FFmpeg native render endpoint.
 * Supports `?async=1` for instant job ID return + live `-progress pipe:1` polling,
 * or synchronous binary response when `?async=1` is omitted.
 */
async function apiNativeRender(req, res, query) {
  const boundary = boundaryOf(req);
  if (!boundary) return fail(res, 400, "Expected multipart/form-data");
  const dir = await tempDir("native-render-");
  const fields = {};
  const mediaFiles = new Map();
  let keepDir = false;

  try {
    await readMultipart(req, boundary, {
      onFile({ name, filename }) {
        const mediaId = name.startsWith("media_") ? name.slice(6) : name === "media" ? "default" : null;
        if (!mediaId) return fs.createWriteStream(path.join(dir, "ignored.bin"));
        const target = path.join(dir, `${id()}_${path.basename(filename || "input.bin")}`);
        mediaFiles.set(mediaId, target);
        return fs.createWriteStream(target);
      },
      onField(name, value) {
        fields[name] = value;
      },
    });

    if (!mediaFiles.size) return fail(res, 400, "No source media was uploaded");
    let project;
    try {
      project = JSON.parse(fields.project || "");
    } catch {
      return fail(res, 400, "Invalid project data");
    }

    const width = Math.round(clampNumber(fields.width, 2, 4096, 1080));
    const height = Math.round(clampNumber(fields.height, 2, 8192, 1920));
    const fps = Math.round(clampNumber(fields.fps, 1, 120, 60));
    const format = fields.format === "webm" ? "webm" : "mp4";

    const { args, out, totalDuration } = await prepareNativeFfmpegRun(dir, project, mediaFiles, { width, height, fps, format });

    if (query?.get("async") === "1") {
      keepDir = true;
      const jobId = id();
      const job = {
        id: jobId,
        dir,
        out,
        format,
        duration: totalDuration,
        status: "rendering",
        progress: 0,
        fps: 0,
        remaining: totalDuration,
        error: null,
        child: null,
        cancelled: false,
        at: Date.now(),
      };
      nativeJobs.set(jobId, job);

      let buf = "";
      void run("ffmpeg", args, {
        timeout: 0,
        onSpawn(child) {
          job.child = child;
        },
        onStdout(chunk) {
          buf += chunk;
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() || "";
          for (const line of lines) {
            const eq = line.indexOf("=");
            if (eq < 0) continue;
            const k = line.slice(0, eq).trim();
            const v = line.slice(eq + 1).trim();
            if (k === "fps") {
              const parsed = Number(v);
              if (Number.isFinite(parsed) && parsed > 0) job.fps = Math.round(parsed);
            } else if (k === "out_time_us") {
              const us = Number(v);
              if (Number.isFinite(us) && us >= 0 && totalDuration > 0) {
                const sec = us / 1_000_000;
                job.progress = Math.min(0.99, sec / totalDuration);
                const rate = job.fps > 0 ? job.fps / fps : 1;
                job.remaining = Math.max(0, (totalDuration - sec) / Math.max(0.25, rate));
                job.at = Date.now();
              }
            }
          }
        },
      }).then((r) => {
        job.child = null;
        if (job.cancelled) {
          job.status = "cancelled";
          return;
        }
        if (r.code !== 0 || !fs.existsSync(out)) {
          job.status = "failed";
          job.error = r.stderr.split("\n").filter(Boolean).slice(-2).join(" ") || "FFmpeg native render failed";
          return;
        }
        job.status = "done";
        job.progress = 1;
        job.remaining = 0;
        job.at = Date.now();
      });

      return json(res, 200, { id: jobId, duration: totalDuration });
    }

    const r = await run("ffmpeg", args, { timeout: 0 });
    if (r.code !== 0 || !fs.existsSync(out)) {
      return fail(res, 500, r.stderr.split("\n").filter(Boolean).slice(-2).join(" ") || "FFmpeg native render failed");
    }
    await sendFile(req, res, out, format === "webm" ? "video/webm" : "video/mp4");
  } catch (e) {
    if (!res.headersSent) fail(res, 500, String(e?.message || e || "Native render failed"));
  } finally {
    if (!keepDir) {
      res.on("close", () => { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); });
    }
  }
}

function apiNativeStatus(_req, res, query) {
  const job = nativeJobs.get(query.get("id") || "");
  if (!job) return fail(res, 404, "Render job not found");
  json(res, 200, {
    id: job.id,
    status: job.status,
    progress: job.progress,
    fps: job.fps,
    remaining: job.remaining,
    error: job.error,
  });
}

async function apiNativeResult(req, res, query) {
  const job = nativeJobs.get(query.get("id") || "");
  if (!job || job.status !== "done" || !fs.existsSync(job.out)) {
    return fail(res, 404, "Rendered output not ready");
  }
  const mime = job.format === "webm" ? "video/webm" : "video/mp4";
  await sendFile(req, res, job.out, mime);
  nativeJobs.delete(job.id);
  res.on("close", () => { fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {}); });
}

function apiNativeAbort(_req, res, query) {
  const job = nativeJobs.get(query.get("id") || "");
  if (job) {
    job.cancelled = true;
    try { job.child?.kill("SIGKILL"); } catch { /* best effort */ }
    nativeJobs.delete(job.id);
    fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
  json(res, 200, { ok: true });
}

module.exports = {
  "POST /api/render": apiRender,
  "POST /api/render/native": apiNativeRender,
  "GET /api/render/native/status": apiNativeStatus,
  "GET /api/render/native/result": apiNativeResult,
  "POST /api/render/native/abort": apiNativeAbort,
  "POST /api/render/start": apiRenderStart,
  "POST /api/render/frames": apiRenderFrames,
  "POST /api/render/finish": apiRenderFinish,
  "POST /api/render/abort": apiRenderAbort,
};
