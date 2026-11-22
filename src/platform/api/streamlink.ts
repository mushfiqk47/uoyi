import { apiJson, apiPostJson } from "./client";

export interface ServerRecordHandle {
  id: string;
  title?: string;
  seconds?: number;
}

export interface ServerRecordStatus {
  status: "recording" | "done" | "failed" | "unknown";
  seconds: number;
  bytes: number;
  err?: string;
  title?: string;
}

export interface ServerRecordResult {
  id: string;
  title: string;
  seconds: number;
  bytes: number;
  url: string;
  mime?: string;
  alreadyFinalized?: boolean;
  hasAudio?: boolean;
  hasVideo?: boolean;
}

export function startServerRecord(url: string, title?: string, quality?: "fullhd" | "smooth"): Promise<ServerRecordHandle> {
  return apiPostJson<ServerRecordHandle>("/api/streamlink/record", { url, title, quality });
}

export function serverRecordStatus(id: string): Promise<ServerRecordStatus> {
  return apiJson<ServerRecordStatus>(`/api/streamlink/status?id=${encodeURIComponent(id)}`);
}

export function listServerRecords(): Promise<{ items: Array<{ id: string; url: string; title: string; status: string; seconds: number; bytes: number }> }> {
  return apiJson("/api/streamlink/list");
}

export function stopServerRecord(id: string): Promise<ServerRecordResult> {
  return apiPostJson<ServerRecordResult>(`/api/streamlink/stop?id=${encodeURIComponent(id)}`, {});
}

/** Stops a recording and discards the file instead of saving it. */
export function cancelServerRecord(id: string): Promise<{ ok: boolean }> {
  return apiPostJson<{ ok: boolean }>(`/api/streamlink/cancel?id=${encodeURIComponent(id)}`, {});
}

let availability: Promise<boolean> | null = null;
/** True once per session when the server reports a usable Streamlink install. */
export function serverRecordAvailable(): Promise<boolean> {
  availability ??= fetch("/api/health")
    .then((r) => r.json())
    .then((h) => Boolean(h?.streamlink))
    .catch(() => false);
  return availability;
}
