import type { CaptionWord } from "../types";
import type { Settings } from "../settings";
import { uid } from "../util";
import { parseSubtitles } from "../subtitles";
import { apiJson } from "../../platform/api/client";

export interface GeneratedCaptions {
  text: string;
  words: CaptionWord[];
  raw?: any;
}

function wordsFromData(data: any): CaptionWord[] {
  const raw = data?.words || data?.result?.words || data?.segments?.flatMap?.((s: any) => s.words || []) || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((w: any) => {
      const text = String(w.word ?? w.text ?? "").trim();
      const start = Number(w.start ?? w.t0 ?? w.offset ?? 0);
      const end = Number(w.end ?? w.t1 ?? start + 0.2);
      if (!text) return null;
      return { id: uid("w"), text, start: Number.isFinite(start) ? start : 0, end: Number.isFinite(end) ? Math.max(end, start + 0.05) : start + 0.2 };
    })
    .filter(Boolean) as CaptionWord[];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    r.onerror = () => reject(r.error || new Error("Failed to read audio"));
    r.readAsDataURL(blob);
  });
}

export interface CaptionClipRange {
  in: number;
  out: number;
  speed: number;
}

export function mapRawWordsToClipRanges(words: CaptionWord[], clips: CaptionClipRange[]): CaptionWord[] {
  if (!clips.length) return words;
  const out: CaptionWord[] = [];
  let cursor = 0;
  for (const c of clips) {
    const cIn = Math.max(0, Number(c.in) || 0);
    const cOut = Math.max(cIn + 0.05, Number(c.out) || cIn + 0.05);
    const speed = Math.max(0.25, Math.min(4, Number(c.speed) || 1));
    const len = (cOut - cIn) / speed;
    for (const w of words) {
      if (w.end <= cIn || w.start >= cOut) continue;
      const ws = cursor + Math.max(0, w.start - cIn) / speed;
      const we = cursor + Math.min(cOut - cIn, Math.max(w.start - cIn + 0.05, w.end - cIn)) / speed;
      out.push({
        id: uid("w"),
        text: w.text,
        start: Number(ws.toFixed(3)),
        end: Number(Math.max(ws + 0.05, we).toFixed(3)),
      });
    }
    cursor += len;
  }
  return out;
}

export async function generateCaptionsForBlob(
  blob: Blob,
  settings: Pick<Settings, "captionModel" | "nemoSpeechUrl"> & Partial<Settings>,
  opts?: { language?: string; format?: "json" | "srt" | "vtt"; diarize?: boolean; clips?: CaptionClipRange[] },
): Promise<GeneratedCaptions> {
  // Prefer NeMo-Speech HTTP API if configured, fallback to local dev helper which shells out to nemo-speech CLI.
  const nemo = settings.nemoSpeechUrl?.replace(/\/+$/, "");
  const mime = blob.type || "audio/wav";
  const localQuery = new URLSearchParams({
    mime,
    model: settings.captionModel || "parakeet-tdt",
    language: opts?.language || "",
    format: opts?.format || "json",
    diarize: opts?.diarize ? "1" : "0",
    nemoSpeechUrl: settings.nemoSpeechUrl || "",
  });

  let res: Response | null = null;
  let data: any = null;
  let lastErr = "";
  const isLocalHost = (raw: string) => {
    try {
      const h = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1";
    } catch { return false; }
  };
  if (nemo && (!settings.localOnlyMode || isLocalHost(nemo))) {
    try {
      // The external nemo-speech HTTP helper expects a JSON body; only the bundled API
      // (which we own) accepts the streamed multipart upload.
      const payload = {
        audioBase64: await blobToBase64(blob),
        mime,
        model: settings.captionModel || "parakeet-tdt",
        language: opts?.language || "",
        format: opts?.format || "json",
        diarize: !!opts?.diarize,
        nemoSpeechUrl: settings.nemoSpeechUrl || "",
      };
      res = await fetch(`${nemo}/api/captions/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => null);
      if (res.ok && j) {
        data = j;
      } else lastErr = (j && (j.detail || j.error)) || (await res.text().catch(() => "")) || `HTTP ${res.status}`;
    } catch (e) {
      lastErr = String((e as Error)?.message || e);
    }
  }
  if (!data) {
    const form = new FormData();
    form.append("file", blob, "audio.bin");
    if (settings.localOnlyMode) form.append("localOnly", "1");
    if (opts?.clips?.length) form.append("clips", JSON.stringify(opts.clips));
    try {
      data = await apiJson<any>(`/api/captions/generate?${localQuery}`, { method: "POST", body: form });
    } catch (e) {
      throw new Error((e as Error).message || lastErr || "Caption generation failed");
    }
  }

  const text = String(data.text || data.transcript || "");
  let words = wordsFromData(data.data || data);
  if (!words.length && (data.format === "srt" || data.format === "vtt" || /-->/.test(text))) words = parseSubtitles(text);
  if (opts?.clips?.length && words.length) {
    words = mapRawWordsToClipRanges(words, opts.clips);
  }
  return { text, words, raw: data };
}
