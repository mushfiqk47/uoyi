"use strict";

const fsp = require("node:fs/promises");

const GEMINI_DEFAULT_MODEL = "gemini-4-hydrogen";
const GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

const DEPRECATED_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-2.0-flash-thinking",
  "gemini-2.5-flash",
]);

// Old "-latest" aliases and retired IDs the current API version no longer serves.
const LEGACY_MODEL_ALIASES = new Map([
  ["gemini-flash-latest", GEMINI_DEFAULT_MODEL],
  ["gemini-pro-latest", GEMINI_DEFAULT_MODEL],
  ["gemini-flash-lite-latest", GEMINI_FALLBACK_MODEL],
  ["gemini-2.5-flash-lite", GEMINI_FALLBACK_MODEL],
  ["gemini-2.5-pro", GEMINI_DEFAULT_MODEL],
]);

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import("@google/genai");
  return sdkPromise;
}

function hasGeminiKey() {
  return Boolean(String(process.env.GEMINI_API_KEY || "").trim());
}

function resolveGeminiModel(requested) {
  const clean = String(requested || "").trim();
  // Settings → AI accepts any model name; only known-retired IDs are replaced.
  if (!clean || DEPRECATED_MODELS.has(clean)) return GEMINI_DEFAULT_MODEL;
  return LEGACY_MODEL_ALIASES.get(clean) || clean;
}

function formatGeminiError(err) {
  const raw = String(err?.message || err || "Gemini request failed");
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) return String(parsed.error.message);
  } catch { /* not pure JSON */ }
  return raw;
}

function isTransientGeminiError(err) {
  const s = String(err?.message || err || "");
  return /503|429|504|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|high demand|overloaded|temporarily|timed out/i.test(s);
}

function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Primary Gemini model timed out")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function isUnknownModelError(err) {
  const s = String(err?.message || err || "");
  return /NOT_FOUND|not found for API version|is not supported for/i.test(s);
}

async function generateWithFallback(ai, request, primaryTimeoutMs = 20000) {
  // Retry the other built-in model on overload, including when the fast fallback itself is busy.
  const alternate = request.model === GEMINI_FALLBACK_MODEL ? GEMINI_DEFAULT_MODEL : GEMINI_FALLBACK_MODEL;
  try {
    const canFallback = request.model !== GEMINI_FALLBACK_MODEL;
    const call = ai.models.generateContent(request);
    const response = canFallback ? await withTimeout(call, primaryTimeoutMs) : await call;
    return { response, usedModel: request.model };
  } catch (err) {
    // A retired/unknown model id fails permanently — retry a built-in model once instead of failing.
    if (isUnknownModelError(err)) {
      const retryModel = request.model === GEMINI_DEFAULT_MODEL ? GEMINI_FALLBACK_MODEL : GEMINI_DEFAULT_MODEL;
      try {
        const response = await ai.models.generateContent({ ...request, model: retryModel });
        return { response, usedModel: retryModel };
      } catch (e2) {
        throw new Error(formatGeminiError(e2));
      }
    }
    if (isTransientGeminiError(err) && alternate !== request.model) {
      try {
        const response = await ai.models.generateContent({ ...request, model: alternate });
        return { response, usedModel: alternate };
      } catch (e2) {
        throw new Error(formatGeminiError(e2));
      }
    }
    throw new Error(formatGeminiError(err));
  }
}

async function getClient(apiKeyOverride) {
  const apiKey = String(apiKeyOverride || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Paste one in Settings → AI (Gemini), or set GEMINI_API_KEY in Google AI Studio Secrets.");
  }
  const { GoogleGenAI, Type } = await loadSdk();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
  return { ai, Type };
}

function parseDataUrl(url) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(url || ""));
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: String(content || "") }];
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string") {
      parts.push({ text: item.text });
    } else if (item.type === "image_url" && item.image_url?.url) {
      const parsed = parseDataUrl(item.image_url.url);
      if (parsed) parts.push({ inlineData: parsed });
    }
  }
  return parts.length ? parts : [{ text: "" }];
}

async function chatWithGemini({ model, messages, json = false, apiKey }) {
  const { ai } = await getClient(apiKey);
  const chosenModel = resolveGeminiModel(model);

  const sysParts = [];
  const contents = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg) continue;
    if (msg.role === "system") {
      const txt = typeof msg.content === "string" ? msg.content : toGeminiParts(msg.content).map((p) => p.text || "").join("\n");
      if (txt.trim()) sysParts.push(txt.trim());
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: toGeminiParts(msg.content),
      });
    }
  }

  const config = {};
  if (sysParts.length) config.systemInstruction = sysParts.join("\n\n");
  if (json) config.responseMimeType = "application/json";

  const { response, usedModel } = await generateWithFallback(ai, {
    model: chosenModel,
    contents: contents.length ? contents : [{ role: "user", parts: [{ text: "Hello" }] }],
    config,
  });

  const text = String(response.text || "");
  return {
    choices: [{ message: { role: "assistant", content: text } }],
    model: usedModel,
    provider: "aistudio-gemini",
  };
}

function distributeWordsOverRange(text, start, end) {
  const tokens = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const span = Math.max(0.2, end - start);
  const step = span / tokens.length;
  return tokens.map((word, idx) => ({
    text: word,
    start: Number((start + idx * step).toFixed(3)),
    end: Number((start + (idx + 1) * step).toFixed(3)),
  }));
}

const INLINE_AUDIO_LIMIT_BYTES = 12 * 1024 * 1024;

async function uploadAudioPart(ai, audioPath, mimeType = "audio/mp3") {
  const stat = await fsp.stat(audioPath);
  if (stat.size <= INLINE_AUDIO_LIMIT_BYTES) {
    const buf = await fsp.readFile(audioPath);
    return {
      part: { inlineData: { mimeType, data: buf.toString("base64") } },
      cleanup: async () => {},
    };
  }
  const uploaded = await ai.files.upload({ file: audioPath, config: { mimeType } });
  let fileInfo = uploaded;
  let attempts = 0;
  while (fileInfo?.state === "PROCESSING" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    fileInfo = await ai.files.get({ name: uploaded.name });
    attempts++;
  }
  return {
    part: {
      fileData: {
        fileUri: fileInfo?.uri || uploaded.uri,
        mimeType: fileInfo?.mimeType || mimeType,
      },
    },
    cleanup: async () => {
      if (uploaded?.name) await ai.files.delete({ name: uploaded.name }).catch(() => {});
    },
  };
}

async function transcribeAudioWithGemini(audioPath, durationSeconds, opts = {}) {
  const { ai, Type } = await getClient();
  const duration = Math.max(0.5, Number(durationSeconds) || 30);
  const langNote = opts?.language ? ` Primary spoken language: ${String(opts.language).trim()}.` : "";
  const { part: audioPart, cleanup } = await uploadAudioPart(ai, audioPath, "audio/mp3");

  try {
    try {
      const { response } = await generateWithFallback(ai, {
        model: GEMINI_DEFAULT_MODEL,
        contents: {
          parts: [
            audioPart,
            {
              text:
                `Transcribe all spoken words and vocal reactions in this ${duration.toFixed(1)}s audio track accurately.${langNote} ` +
                `Return JSON with: text (full transcript), segments (start/end seconds and text), and words (every spoken word with accurate start/end seconds within 0..${duration.toFixed(2)}).`,
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                  },
                },
              },
              words: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                  },
                },
              },
            },
          },
        },
      }, 45000);

      const parsed = JSON.parse(String(response.text || "{}"));
      const segments = Array.isArray(parsed.segments)
        ? parsed.segments
            .map((s) => ({
              start: Math.max(0, Math.min(duration, Number(s.start) || 0)),
              end: Math.max(0.1, Math.min(duration, Number(s.end) || 0)),
              text: String(s.text || "").trim(),
            }))
            .filter((s) => s.text)
        : [];

      let words = Array.isArray(parsed.words)
        ? parsed.words
            .map((w) => {
              const text = String(w.text ?? w.word ?? "").trim();
              const start = Math.max(0, Math.min(duration, Number(w.start) || 0));
              const end = Math.max(start + 0.05, Math.min(duration, Number(w.end) || start + 0.2));
              return text ? { text, start, end } : null;
            })
            .filter(Boolean)
        : [];

      if (!words.length && segments.length) {
        words = segments.flatMap((s) => distributeWordsOverRange(s.text, s.start, Math.max(s.start + 0.2, s.end)));
      }
      const text = String(parsed.text || segments.map((s) => s.text).join(" ") || "").trim();
      if (!words.length && text) {
        words = distributeWordsOverRange(text, 0, duration);
      }
      if (text || words.length) {
        return { text, segments, words, provider: "aistudio-gemini" };
      }
    } catch {
      // Fall back to dedicated transcription model below
    }

    const { response: fallback } = await generateWithFallback(ai, {
      model: GEMINI_TRANSCRIBE_MODEL,
      contents: {
        parts: [audioPart, { text: `Transcribe all speech in this audio.${langNote}` }],
      },
    });
    const text = String(fallback.text || "").trim();
    const words = text ? distributeWordsOverRange(text, 0, duration) : [];
    return {
      text,
      segments: text ? [{ start: 0, end: duration, text }] : [],
      words,
      provider: "aistudio-gemini",
    };
  } finally {
    await cleanup();
  }
}

async function analyzeMediaWithGemini({ audioPath, frameFiles = [], durationSeconds, topPeaks = [], nemoTranscript = "" }) {
  const { ai } = await getClient();
  const duration = Math.max(1, Number(durationSeconds) || 30);
  const parts = [];
  let cleanupAudio = async () => {};

  if (audioPath) {
    try {
      const st = await fsp.stat(audioPath);
      if (st.size > 0) {
        const uploaded = await uploadAudioPart(ai, audioPath, "audio/mp3");
        parts.push(uploaded.part);
        cleanupAudio = uploaded.cleanup;
      }
    } catch {
      /* audio optional for silent videos */
    }
  }

  for (const frame of frameFiles.slice(0, 12)) {
    try {
      const imgBuf = await fsp.readFile(frame.path);
      parts.push({ text: `[Visual frame at ${Number(frame.time).toFixed(1)}s]` });
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: imgBuf.toString("base64"),
        },
      });
    } catch {
      /* skip unreadable frame */
    }
  }

  const peakNote = topPeaks.length
    ? `\nMeasured audio loudness peaks: ${topPeaks.map((p) => `${p.time.toFixed(1)}s (${p.lufs} LUFS)`).join(", ")}.`
    : "";
  const transcriptNote = nemoTranscript
    ? `\nReference speech transcript:\n${String(nemoTranscript).slice(0, 8000)}`
    : "";

  parts.push({
    text:
      `Analyze this ${duration.toFixed(1)}s video or stream using the audio track, timestamped visual frames, and signal cues.${peakNote}${transcriptNote}\n` +
      `Produce a chronological timestamped log covering the entire duration from 0.0s to ${duration.toFixed(1)}s. ` +
      `For every segment, include:\n` +
      `1. Exact timestamps in the format [start-end] (in seconds, e.g. [12.4-18.9])\n` +
      `2. Spoken dialogue, laughs, hype reactions, jokes, or strong punchlines\n` +
      `3. Key visual events (action peaks, clutch plays, score/HUD changes, facial reactions, sudden reveals, or scene cuts)\n` +
      `Keep lines dense, factual, and timestamp-accurate so a clip-finder can pick the best standalone short-form moments.`,
  });

  try {
    const { response } = await generateWithFallback(ai, {
      model: GEMINI_DEFAULT_MODEL,
      contents: { parts },
    }, 45000);
    return String(response.text || "").trim();
  } finally {
    await cleanupAudio();
  }
}

async function detectFacecamWithGemini(imageBase64) {
  const { ai, Type } = await getClient();
  const { response } = await generateWithFallback(ai, {
    model: GEMINI_DEFAULT_MODEL,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBase64,
          },
        },
        {
          text:
            "Locate the streamer webcam/facecam overlay box (or primary human face) in this gaming/stream frame. " +
            "Return normalized coordinates in 0..1 relative to image width and height: x (left), y (top), w (width), h (height). " +
            "If there is a picture-in-picture webcam box, return the full webcam box (or face region inside it) and set best=0. " +
            "If no face or facecam is visible, return faces: [] and best: -1.",
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          faces: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                w: { type: Type.NUMBER },
                h: { type: Type.NUMBER },
              },
            },
          },
          best: { type: Type.INTEGER },
        },
      },
    },
  });

  const parsed = JSON.parse(String(response.text || "{}"));
  const faces = Array.isArray(parsed.faces)
    ? parsed.faces
        .map((f) => ({
          x: Math.max(0, Math.min(0.95, Number(f.x) || 0)),
          y: Math.max(0, Math.min(0.95, Number(f.y) || 0)),
          w: Math.max(0.05, Math.min(1, Number(f.w) || 0.2)),
          h: Math.max(0.05, Math.min(1, Number(f.h) || 0.2)),
        }))
        .filter((f) => f.w > 0 && f.h > 0)
    : [];
  const best = faces.length ? Math.max(0, Math.min(faces.length - 1, Number(parsed.best) || 0)) : -1;
  return { faces, best, provider: "aistudio-gemini" };
}

module.exports = {
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODEL,
  hasGeminiKey,
  resolveGeminiModel,
  generateWithFallback,
  chatWithGemini,
  transcribeAudioWithGemini,
  analyzeMediaWithGemini,
  detectFacecamWithGemini,
};
