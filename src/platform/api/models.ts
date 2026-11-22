import { apiJson, apiPostJson } from "./client";

export interface SpeechModel {
  id: string;
  label: string;
  repo: string;
  size: string;
  description: string;
  installed: boolean;
  /** Which local backend has the model: "audiocpp" (app-provisioned) or "nemo" (nemo-speech CLI). */
  backend?: string | null;
}

export async function listSpeechModels(): Promise<SpeechModel[]> {
  const data = await apiJson<{ models?: SpeechModel[] }>("/api/models");
  return Array.isArray(data.models) ? data.models : [];
}

export function downloadSpeechModel(id: string): Promise<{ id: string; status: string }> {
  return apiPostJson<{ id: string; status: string }>("/api/models/download", { id });
}

export async function speechModelStatus(id: string): Promise<{ id: string; status: string; log: string; progress: number }> {
  try {
    return await apiJson<{ id: string; status: string; log: string; progress: number }>(
      `/api/models/status?id=${encodeURIComponent(id)}`,
    );
  } catch {
    return { id, status: "unknown", log: "", progress: 0 };
  }
}

export interface SpeechInstallUpdate {
  status: string;
  log: string;
  progress: number;
}

/**
 * Full setup flow behind the Download & use buttons: provisions the audio.cpp runtime
 * (latest prebuilt release) when missing, then downloads the model GGUF — with progress.
 * Resolves once the model is ready; throws with an actionable message otherwise.
 */
export async function installSpeechModel(
  id: string,
  onUpdate?: (u: SpeechInstallUpdate) => void,
  timeoutMs = 60 * 60 * 1000,
): Promise<void> {
  const job = await downloadSpeechModel(id);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("Download timed out. Check the dev-server terminal and try again.");
    const s = await speechModelStatus(job.id || id);
    onUpdate?.(s);
    if (s.status === "ready") return;
    if (s.status === "failed") throw new Error(s.log || "Download failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * True when transcribing works without any setup: a local model is downloaded
 * (audio.cpp or nemo-speech) or the server has a Gemini key as fallback.
 */
export async function speechModelReady(): Promise<boolean> {
  try {
    const h = await apiJson<{ audiocppParakeet?: boolean; nemo?: boolean; gemini?: boolean }>("/api/health");
    return Boolean(h.audiocppParakeet || h.nemo || h.gemini);
  } catch {
    return true; // server may still be starting; don't block the form on a probe failure
  }
}
