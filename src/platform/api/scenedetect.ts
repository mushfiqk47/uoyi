import { apiJson, apiPostJson } from "./client";

export interface SceneSpan {
  start: number;
  end: number;
  duration: number;
}

export interface SceneDetectHandle {
  id: string;
  status?: string;
  backend?: string;
}

export interface SceneDetectStatus {
  status: "running" | "done" | "failed" | "unknown";
  seconds: number;
  count?: number;
  backend?: string;
  err?: string;
  scenes?: SceneSpan[];
}

export function startSceneDetect(mediaId: string): Promise<SceneDetectHandle> {
  return apiPostJson<SceneDetectHandle>("/api/scenedetect/start", { id: mediaId });
}

export function sceneDetectStatus(id: string): Promise<SceneDetectStatus> {
  return apiJson<SceneDetectStatus>(`/api/scenedetect/status?id=${encodeURIComponent(id)}`);
}

export function cancelSceneDetect(id: string): Promise<{ ok: boolean }> {
  return apiPostJson<{ ok: boolean }>(`/api/scenedetect/cancel?id=${encodeURIComponent(id)}`, {});
}

let availability: Promise<boolean> | null = null;
/** True once per session when the server reports either PySceneDetect or FFmpeg scene detection. */
export function sceneDetectAvailable(): Promise<boolean> {
  availability ??= fetch("/api/health")
    .then((r) => r.json())
    .then((h) => Boolean(h?.scenedetect))
    .catch(() => false);
  return availability;
}
