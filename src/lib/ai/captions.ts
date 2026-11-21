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

export async function generateCaptionsForBlob(
  blob: Blob,
  settings: Pick<Settings, "captionModel" | "nemoSpeechUrl"> & Partial<Settings>,
  opts?: { language?: string; format?: "json" | "srt" | "vtt"; diarize?: boolean },
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
  if (nemo) {
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
      if (res.ok && j) data = j;
      else lastErr = (j && (j.detail || j.error)) || (await res.text().catch(() => "")) || `HTTP ${res.status}`;
    } catch (e) {
      lastErr = String((e as Error)?.message || e);
    }
  }
  if (!data) {
    const form = new FormData();
    form.append("file", blob, "audio.bin");
    try {
      data = await apiJson<any>(`/api/captions/generate?${localQuery}`, { method: "POST", body: form });
    } catch (e) {
      throw new Error((e as Error).message || lastErr || "Caption generation failed");
    }
  }

  const text = String(data.text || data.transcript || "");
  let words = wordsFromData(data.data || data);
  if (!words.length && (data.format === "srt" || data.format === "vtt" || /-->/.test(text))) words = parseSubtitles(text);
  if (!words.length && text.trim()) {
    // Last resort: spread words over unknown duration-less transcript is bad; return empty words but keep text.
  }
  return { text, words, raw: data };
}
