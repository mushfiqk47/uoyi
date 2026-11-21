import { apiJson, apiPostJson } from "./client";

export interface SpeechModel {
  id: string;
  label: string;
  repo: string;
  size: string;
  description: string;
  installed: boolean;
}

export async function listSpeechModels(): Promise<SpeechModel[]> {
  const data = await apiJson<{ models?: SpeechModel[] }>("/api/models");
  return Array.isArray(data.models) ? data.models : [];
}

export function downloadSpeechModel(id: string): Promise<{ id: string; status: string }> {
  return apiPostJson<{ id: string; status: string }>("/api/models/download", { id });
}

export async function speechModelStatus(id: string): Promise<{ id: string; status: string; log: string }> {
  try {
    return await apiJson<{ id: string; status: string; log: string }>(`/api/models/status?id=${encodeURIComponent(id)}`);
  } catch {
    return { id, status: "unknown", log: "" };
  }
}
