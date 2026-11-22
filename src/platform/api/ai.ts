import { apiPostJson } from "./client";

/** Local proxy fallback for a chat completion when no direct endpoint is configured. */
export function chatProxy<T>(body: unknown): Promise<T> {
  return apiPostJson<T>("/api/ai/chat", body);
}

export interface FacecamResult {
  faces?: Array<{ x: number; y: number; w: number; h: number }>;
  best?: number;
  [key: string]: unknown;
}

export function detectFacecam(payload: { imageBase64: string; referenceBase64?: string | null }): Promise<FacecamResult> {
  return apiPostJson<FacecamResult>("/api/facecam/detect", payload);
}
