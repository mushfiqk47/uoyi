import { apiFetch, apiJson, apiPostJson } from "./client";

export interface MediaJob {
  id: string;
  title?: string;
}

export interface MediaStatus {
  id?: string;
  status: "preparing" | "ready" | "failed" | "unknown";
  err?: string;
  title?: string;
}

export function uploadMediaFile(file: File): Promise<MediaJob> {
  return apiJson<MediaJob>(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
}

export function uploadMediaBlob(blob: Blob, name: string): Promise<MediaJob> {
  return apiJson<MediaJob>(`/api/upload?name=${encodeURIComponent(name)}`, { method: "POST", body: blob });
}

export function prepareMedia(url: string): Promise<MediaJob> {
  return apiPostJson<MediaJob>("/api/media/prepare", { url });
}

export function mediaStatus(id: string): Promise<MediaStatus> {
  return apiJson<MediaStatus>(`/api/media/status?id=${encodeURIComponent(id)}`);
}

export interface AnalyzeResult {
  transcript?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export function analyzeMedia(id: string): Promise<AnalyzeResult> {
  return apiPostJson<AnalyzeResult>("/api/analyze", { id });
}

export interface CutClipInput {
  id: string;
  start: number;
  end: number;
  title?: string;
  vertical?: boolean;
}

export interface CutClipResult {
  url: string;
  duration?: number;
  thumb?: string | null;
}

export function cutClip(input: CutClipInput): Promise<CutClipResult> {
  return apiPostJson<CutClipResult>("/api/clip/cut", input);
}

export async function fetchClipBlob(url: string): Promise<Blob> {
  return apiFetch(url).then((res) => res.blob());
}

export interface FinalizedClip {
  blob: Blob;
  mime: string;
  duration: number;
  hasAudio: boolean;
  hasVideo: boolean;
  gpu: boolean;
}

/** Remuxes a captured WebM into MP4. Returns null when the local helper cannot finish, which
 *  callers treat as "keep the original", exactly like the previous implementation. */
export async function finalizeClipBlob(blob: Blob, inPoint: number, duration: number): Promise<FinalizedClip | null> {
  try {
    const form = new FormData();
    form.append("file", blob, "clip.webm");
    const res = await apiFetch(`/api/clip/finalize?in=${inPoint}&duration=${duration}`, { method: "POST", body: form });
    const out = await res.blob();
    if (!out.size) return null;
    return {
      blob: out,
      mime: out.type || "video/mp4",
      duration,
      hasAudio: res.headers.get("X-Clipweave-Has-Audio") !== "0",
      hasVideo: res.headers.get("X-Clipweave-Has-Video") !== "0",
      gpu: res.headers.get("X-Clipweave-Gpu") === "1",
    };
  } catch {
    return null;
  }
}
