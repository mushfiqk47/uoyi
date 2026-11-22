"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { json, fail, readJson } = require("../lib/http.cjs");
const { readMultipart, boundaryOf } = require("../lib/multipart.cjs");
const { run, hasTool, probe } = require("../lib/proc.cjs");
const { tempDir } = require("../lib/files.cjs");
const { resolveMediaJob, touchEntry } = require("../state.cjs");
const { validateExternalHttpUrl } = require("../lib/security.cjs");
const { log } = require("../lib/logger.cjs");
const { getSecret } = require("../services/workspace.cjs");
const { analyzeAudioSignals, extractStoryboardFramesBatched } = require("../lib/signals.cjs");
const { resolveCli, modelInstalled, transcribe } = require("../lib/audiocpp.cjs");
const {
  hasGeminiKey,
  chatWithGemini,
  transcribeAudioWithGemini,
  analyzeMediaWithGemini,
} = require("../lib/gemini.cjs");

function isLocalOnlyRequest(req, body) {
  return body?.localOnly === true || String(req.headers["x-clipweave-local-only"] || "") === "1";
}

function effectiveGeminiKey(explicitKey) {
  const k = String(explicitKey || "").trim();
  if (k) return k;
  return getSecret("gemini") || process.env.GEMINI_API_KEY || "";
}

async function apiChat(req, res) {
  const body = await readJson(req, 16 * 1024 * 1024);
  const localOnly = isLocalOnlyRequest(req, body);
  const geminiKey = effectiveGeminiKey(body.apiKey);
  const useAiStudio =
    body.provider === "aistudio" ||
    (!body.baseUrl && !process.env.CLIPWEAVE_AI_BASE_URL && (hasGeminiKey() || Boolean(geminiKey)));

  if (useAiStudio) {
    if (localOnly) {
      return fail(res, 403, "Local-Only Mode is active. Turn off Local-Only Mode in Settings -> AI & Privacy to use cloud AI.", "LOCAL_ONLY", req);
    }
    try {
      const result = await chatWithGemini({
        model: body.model,
        messages: body.messages,
        json: body.json !== false,
        apiKey: geminiKey || undefined,
      });
      return json(res, 200, result, req);
    } catch (e) {
      log("error", "ai", "Gemini chat request failed", String(e?.message || e));
      return fail(res, 502, String(e?.message || e || "Gemini request failed"), "UPSTREAM_ERROR", req);
    }
  }

  const base = String(body.baseUrl || process.env.CLIPWEAVE_AI_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return fail(res, 400, "No AI endpoint configured. Choose AI Studio (Gemini) or a local Ollama server in Settings -> AI & Privacy.", "NO_ENDPOINT", req);
  const urlCheck = await validateExternalHttpUrl(base, localOnly ? { allowLocalhostOnly: true } : { allowLocalhostOnly: true });
  if (!urlCheck.ok) return fail(res, 400, urlCheck.error || "AI endpoint must be http(s) localhost or a public URL.", "BAD_URL", req);
  if (localOnly) {
    const host = urlCheck.url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
      return fail(res, 403, "Local-Only Mode blocks remote AI servers. Use a localhost model (such as Ollama) or disable Local-Only Mode.", "LOCAL_ONLY", req);
    }
  }

  const providerSecret = getSecret(body.provider || "cloud") || getSecret("openai") || getSecret("kilo") || "";
  const key = body.apiKey || providerSecret || process.env.CLIPWEAVE_AI_KEY || "";
  const payload = { ...body };
  delete payload.baseUrl;
  delete payload.apiKey;
  delete payload.provider;
  delete payload.json;
  delete payload.localOnly;

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
    let sourcePath = "";
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
      if (body.language) fields.language = String(body.language);
      if (body.model) fields.model = String(body.model);
      if (body.localOnly !== undefined) fields.localOnly = body.localOnly;
      if (body.mediaId) {
        const job = resolveMediaJob(String(body.mediaId));
        if (!job) return fail(res, 404, "Workspace media is not available for captions.", "NOT_FOUND", req);
        touchEntry(job);
        sourcePath = job.file;
      } else {
        const base64 = String(body.audioBase64 || "");
        if (!base64) return fail(res, 400, "No audio was provided", "BAD_REQUEST", req);
        await fsp.writeFile(input, Buffer.from(base64, "base64"));
      }
    }

    const mediaInput = sourcePath || input;
    if (!fs.existsSync(mediaInput) || fs.statSync(mediaInput).size === 0) return fail(res, 400, "No audio was provided", "BAD_REQUEST", req);

    const model = String(fields.model || query.get("model") || "parakeet-tdt");
    const language = String(fields.language || query.get("language") || "").trim();
    const localOnly = fields.localOnly === true || fields.localOnly === "true" || isLocalOnlyRequest(req, null);

    const wav = path.join(dir, "audio.wav");
    const work = await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", mediaInput, "-vn", "-ac", "1", "-ar", "16000", wav]);
    if (work.code !== 0 || !fs.existsSync(wav)) return fail(res, 500, "Couldn't read the audio track in that file.", "FFMPEG_AUDIO", req);

    if ((await modelInstalled(model)) && (await resolveCli())) {
      try {
        const langArg = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i.test(language) ? language : "";
        const data = await transcribe(wav, model, langArg, dir);
        return json(res, 200, { ...data, provider: "audiocpp" }, req);
      } catch (e) {
        log("warn", "captions", "audio.cpp transcribe failed, trying fallback", String(e?.message || e));
      }
    }

    if (await hasTool("nemo-speech", ["--version"])) {
      const data = await transcribeWav(wav, model, language);
      return json(res, 200, {
        ...data,
        text: String(data.text || ""),
        words: wordsFromNemo(data),
        segments: data.segments || [],
        provider: "nemo",
      }, req);
    }

    if (localOnly) {
      return fail(res, 403, "Local-Only Mode is active and no local speech model is installed. Download the offline caption model in Settings -> Setup & Hardware.", "LOCAL_ONLY", req);
    }

    const gemKey = effectiveGeminiKey("");
    if (!hasGeminiKey() && !gemKey) {
      return fail(res, 501, "Caption generation needs either a local speech model or a cloud Gemini API key configured in Settings -> AI & Privacy.", "NO_TRANSCRIBER", req);
    }

    const info = await probe(mediaInput);
    const mp3 = path.join(dir, "audio.mp3");
    const mp3Work = await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", mediaInput, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", mp3]);
    if (mp3Work.code !== 0 || !fs.existsSync(mp3)) {
      return fail(res, 500, "Couldn't read the audio track in that file.", "FFMPEG_AUDIO", req);
    }
    const audioInfo = await probe(mp3);
    const duration = info.duration || audioInfo.duration || 10;
    const data = await transcribeAudioWithGemini(mp3, duration, { language, apiKey: gemKey || undefined });
    json(res, 200, { ...data, provider: "aistudio-gemini" }, req);
  } catch (e) {
    log("error", "captions", "Caption generation failed", String(e?.message || e));
    fail(res, 500, String(e.message || e), "INTERNAL_ERROR", req);
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function apiAnalyze(req, res) {
  const body = await readJson(req);
  const localOnly = isLocalOnlyRequest(req, body);
  const job = resolveMediaJob(String(body.id || ""));
  if (!job || job.status !== "ready") return fail(res, 404, "Media isn't ready", "NOT_FOUND", req);
  touchEntry(job);
  const dir = await tempDir("analyze-");
  try {
    const info = await probe(job.file);
    const nemoAvailable = await hasTool("nemo-speech", ["--version"]);
    const audiocppAvailable = (await modelInstalled("parakeet-tdt")) && Boolean(await resolveCli());
    const gemKey = effectiveGeminiKey(body.apiKey);
    const geminiAvailable = !localOnly && (hasGeminiKey() || Boolean(gemKey));

    if (!audiocppAvailable && !nemoAvailable && !geminiAvailable) {
      return fail(
        res,
        localOnly ? 403 : 501,
        localOnly
          ? "Local-Only Mode is active. Install Local Speech-to-Text in Settings -> Setup & Hardware to transcribe and analyze locally."
          : "Media analysis needs either Local Speech-to-Text or a Gemini API key in Settings -> AI & Privacy.",
        localOnly ? "LOCAL_ONLY" : "NO_ANALYZER",
        req,
      );
    }

    const signals = info.hasAudio ? await analyzeAudioSignals(job.file).catch(() => ({ topPeaks: [], silences: [] })) : { topPeaks: [], silences: [] };

    let localTranscript = "";
    let localBackend = "";
    if (info.hasAudio) {
      const wav = path.join(dir, "audio.wav");
      const work = await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", job.file, "-vn", "-ac", "1", "-ar", "16000", wav], { timeout: 0 });
      if (work.code === 0 && fs.existsSync(wav)) {
        let data = null;
        if (audiocppAvailable) {
          data = await transcribe(wav, "parakeet-tdt", "", dir).catch((e) => {
            log("warn", "analyze", "audio.cpp analyze transcribe failed", String(e?.message || e));
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
      if (!localTranscript) return fail(res, 500, "Could not produce a local transcript from that media.", "NO_TRANSCRIPT", req);
      return json(res, 200, {
        transcript: localTranscript,
        duration: info.duration,
        width: info.width,
        height: info.height,
        provider: localBackend || "local",
        peaks: signals.topPeaks,
        silences: signals.silences,
      }, req);
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
      return fail(res, 500, "That media has no readable audio or video track.", "NO_STREAMS", req);
    }

    const transcript = await analyzeMediaWithGemini({
      audioPath: mp3,
      frameFiles: frames,
      durationSeconds: info.duration,
      topPeaks: signals.topPeaks,
      nemoTranscript: localTranscript,
      apiKey: gemKey || undefined,
    });

    json(res, 200, {
      transcript,
      duration: info.duration,
      width: info.width,
      height: info.height,
      provider: localBackend ? `${localBackend}+aistudio-gemini` : "aistudio-gemini",
      peaks: signals.topPeaks,
      silences: signals.silences,
    }, req);
  } catch (e) {
    log("error", "analyze", "Media analysis failed", String(e?.message || e));
    fail(res, 500, String(e.message || e), "INTERNAL_ERROR", req);
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  "POST /api/ai/chat": apiChat,
  "POST /api/captions/generate": apiCaptions,
  "POST /api/analyze": apiAnalyze,
};
