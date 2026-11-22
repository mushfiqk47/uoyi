"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { json, fail, readJson } = require("../lib/http.cjs");
const { readMultipart, boundaryOf } = require("../lib/multipart.cjs");
const { run, hasTool, probe } = require("../lib/proc.cjs");
const { tempDir } = require("../lib/files.cjs");
const { mediaJobs, touchEntry } = require("../state.cjs");
const { validateExternalHttpUrl } = require("../lib/security.cjs");
const { analyzeAudioSignals, extractStoryboardFramesBatched } = require("../lib/signals.cjs");
const { resolveCli, modelInstalled, transcribe } = require("../lib/audiocpp.cjs");
const {
  hasGeminiKey,
  chatWithGemini,
  transcribeAudioWithGemini,
  analyzeMediaWithGemini,
} = require("../lib/gemini.cjs");

async function apiChat(req, res) {
  const body = await readJson(req, 16 * 1024 * 1024);
  const useAiStudio =
    body.provider === "aistudio" ||
    (!body.baseUrl && !process.env.CLIPWEAVE_AI_BASE_URL && hasGeminiKey());

  if (useAiStudio) {
    try {
      const result = await chatWithGemini({
        model: body.model,
        messages: body.messages,
        json: body.json !== false,
        apiKey: body.apiKey,
      });
      return json(res, 200, result);
    } catch (e) {
      return fail(res, 502, String(e?.message || e || "Gemini request failed"));
    }
  }

  const base = String(body.baseUrl || process.env.CLIPWEAVE_AI_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return fail(res, 400, "No AI endpoint configured. Choose AI Studio (Gemini) or set a provider in Settings → AI.");
  const urlCheck = await validateExternalHttpUrl(base, { allowPrivate: true });
  if (!urlCheck.ok) return fail(res, 400, urlCheck.error || "AI endpoint must be an http(s) URL.");
  const key = body.apiKey || process.env.CLIPWEAVE_AI_KEY || "";
  const payload = { ...body };
  delete payload.baseUrl;
  delete payload.apiKey;
  delete payload.provider;
  delete payload.json;
  const upstream = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  }).catch((e) => ({ ok: false, status: 502, text: async () => String(e.message || e) }));
  const text = await upstream.text();
  res.statusCode = upstream.status || 502;
  res.setHeader("Content-Type", "application/json");
  res.end(text);
}

function wordsFromNemo(data) {
  const raw = data?.words || data?.result?.words || data?.segments?.flatMap?.((s) => s.words || []) || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((w) => {
      const text = String(w.word ?? w.text ?? "").trim();
      const start = Number(w.start ?? w.t0 ?? 0);
      const end = Number(w.end ?? w.t1 ?? start + 0.2);
      if (!text) return null;
      return { text, start, end: Math.max(end, start + 0.05) };
    })
    .filter(Boolean);
}

function transcriptFromNemo(data) {
  const segments = Array.isArray(data?.segments) ? data.segments : [];
  if (segments.length) {
    return segments
      .map((s) => `[${Number(s.start || 0).toFixed(1)}-${Number(s.end || 0).toFixed(1)}] ${String(s.text || "").trim()}`)
      .join("\n");
  }
  return String(data?.text || data?.transcript || "");
}

async function transcribeWav(wav, model, language) {
  const args = ["transcribe", wav, "-m", model || "parakeet-tdt", "-f", "json", "--word-times", "--quiet"];
  if (language && /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i.test(String(language).trim())) {
    args.push("--language", String(language).trim());
  }
  const r = await run("nemo-speech", args, { timeout: 600000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || "nemo-speech failed").split("\n").filter(Boolean).slice(-1)[0]);
  const start = r.stdout.indexOf("{");
  if (start < 0) throw new Error("nemo-speech returned no JSON");
  return JSON.parse(r.stdout.slice(start));
}

async function apiCaptions(req, res, query) {
  const dir = await tempDir("captions-");
  try {
    const input = path.join(dir, "input.bin");
    const fields = {};
    if (boundaryOf(req)) {
      await readMultipart(req, boundaryOf(req), {
        onFile() { return fs.createWriteStream(input); },
        onField(name, value) {
          fields[name] = value;
        },
      });
    } else {
      const body = await readJson(req, 128 * 1024 * 1024);
      const base64 = String(body.audioBase64 || "");
      if (!base64) return fail(res, 400, "No audio was provided");
      if (body.language) fields.language = String(body.language);
      if (body.model) fields.model = String(body.model);
      await fsp.writeFile(input, Buffer.from(base64, "base64"));
    }
    if (!fs.existsSync(input) || fs.statSync(input).size === 0) return fail(res, 400, "No audio was provided");

    const model = String(fields.model || query.get("model") || "parakeet-tdt");
    const language = String(fields.language || query.get("language") || "").trim();

    const wav = path.join(dir, "audio.wav");
    const work = await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", wav]);
    if (work.code !== 0 || !fs.existsSync(wav)) return fail(res, 500, "Couldn't read the audio track in that file.");

    // audio.cpp first: the app-provisioned runtime + GGUF, invoked by absolute path.
    if ((await modelInstalled(model)) && (await resolveCli())) {
      try {
        const langArg = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i.test(language) ? language : "";
        const data = await transcribe(wav, model, langArg, dir);
        return json(res, 200, { ...data });
      } catch (e) {
        console.error("[clipweave] audio.cpp transcribe failed, falling back:", String(e.message || e).slice(0, 200));
      }
    }

    if (await hasTool("nemo-speech", ["--version"])) {
      const data = await transcribeWav(wav, model, language);
      return json(res, 200, {
        ...data,
        text: String(data.text || ""),
        words: wordsFromNemo(data),
        segments: data.segments || [],
      });
    }

    if (!hasGeminiKey()) {
      return fail(res, 501, "Caption generation needs either local nemo-speech or GEMINI_API_KEY configured in AI Studio Secrets.");
    }

    const info = await probe(input);
    const mp3 = path.join(dir, "audio.mp3");
    const mp3Work = await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", mp3]);
    if (mp3Work.code !== 0 || !fs.existsSync(mp3)) {
      return fail(res, 500, "Couldn't read the audio track in that file.");
    }
    const audioInfo = await probe(mp3);
    const duration = info.duration || audioInfo.duration || 10;
    const data = await transcribeAudioWithGemini(mp3, duration, { language });
    json(res, 200, data);
  } catch (e) {
    fail(res, 500, String(e.message || e));
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function apiAnalyze(req, res) {
  const { id: mediaId } = await readJson(req);
  const job = mediaJobs.get(String(mediaId || ""));
  if (!job || job.status !== "ready") return fail(res, 404, "Media isn't ready");
  touchEntry(job);
  const dir = await tempDir("analyze-");
  try {
    const info = await probe(job.file);
    const nemoAvailable = await hasTool("nemo-speech", ["--version"]);
    const geminiAvailable = hasGeminiKey();

    if (!nemoAvailable && !geminiAvailable) {
      return fail(res, 501, "Media analysis needs GEMINI_API_KEY in AI Studio Secrets or local nemo-speech.");
    }

    const signals = info.hasAudio ? await analyzeAudioSignals(job.file).catch(() => ({ topPeaks: [], silences: [] })) : { topPeaks: [], silences: [] };

    let localTranscript = "";
    let localBackend = "";
    if (info.hasAudio) {
      const wav = path.join(dir, "audio.wav");
      const work = await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", job.file, "-vn", "-ac", "1", "-ar", "16000", wav], { timeout: 0 });
      if (work.code === 0 && fs.existsSync(wav)) {
        let data = null;
        if ((await modelInstalled("parakeet-tdt")) && (await resolveCli())) {
          data = await transcribe(wav, "parakeet-tdt", "", dir).catch((e) => {
            console.error("[clipweave] audio.cpp analyze transcribe failed:", String(e.message || e).slice(0, 200));
            return null;
          });
          if (data) localBackend = "audiocpp";
        }
        if (!data && nemoAvailable) {
          data = await transcribeWav(wav, "parakeet-tdt").catch(() => null);
          if (data) localBackend = "nemo";
        }
        if (data) localTranscript = transcriptFromNemo(data);
      }
    }

    if (!geminiAvailable) {
      if (!localTranscript) return fail(res, 500, "That media has no readable audio track.");
      return json(res, 200, {
        transcript: localTranscript,
        duration: info.duration,
        width: info.width,
        height: info.height,
        provider: localBackend || "nemo",
        peaks: signals.topPeaks,
        silences: signals.silences,
      });
    }

    let mp3 = null;
    if (info.hasAudio) {
      const candidate = path.join(dir, "audio.mp3");
      const work = await run(
        "ffmpeg",
        ["-y", "-hide_banner", "-loglevel", "error", "-i", job.file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", candidate],
        { timeout: 0 },
      );
      if (work.code === 0 && fs.existsSync(candidate)) mp3 = candidate;
    }

    const frames = info.hasVideo ? await extractStoryboardFramesBatched(job.file, dir, info.duration, 10) : [];
    if (!mp3 && !frames.length) {
      return fail(res, 500, "That media has no readable audio or video track.");
    }

    const transcript = await analyzeMediaWithGemini({
      audioPath: mp3,
      frameFiles: frames,
      durationSeconds: info.duration,
      topPeaks: signals.topPeaks,
      nemoTranscript: localTranscript,
    });

    json(res, 200, {
      transcript,
      duration: info.duration,
      width: info.width,
      height: info.height,
      provider: localBackend ? `${localBackend}+aistudio-gemini` : "aistudio-gemini",
      peaks: signals.topPeaks,
      silences: signals.silences,
    });
  } catch (e) {
    fail(res, 500, String(e.message || e));
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  "POST /api/ai/chat": apiChat,
  "POST /api/captions/generate": apiCaptions,
  "POST /api/analyze": apiAnalyze,
};
