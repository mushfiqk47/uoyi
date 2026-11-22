import { apiJson, apiPostJson } from "./client";

export type DependencyTier = "required" | "recommended" | "optional";

export interface SetupItem {
  id: string;
  label: string;
  tier?: DependencyTier;
  required: boolean;
  installed: boolean;
  /** "app" = installed into the app bin folder, "path" = found on PATH, "missing". */
  source: "app" | "path" | "missing";
  version: string;
  sizeLabel?: string;
  estimatedBytes?: number;
  note: string;
}

export interface SetupJob {
  status: string;
  log: string;
  progress: number;
}

export interface SystemProfile {
  platform: string;
  arch: string;
  release: string;
  cpus: number;
  cpuModel: string;
  totalRamBytes: number;
  gpu?: {
    vendor: string;
    encoder: string;
    hardware: boolean;
    label: string;
  } | null;
  pythonAvailable?: boolean;
  dataDir?: string;
  workspaceDir?: string;
  freeDataBytes?: number | null;
  freeWorkspaceBytes?: number | null;
}

export async function fetchSetupStatus(): Promise<{ items: SetupItem[]; jobs: Record<string, SetupJob>; system?: SystemProfile }> {
  return apiJson<{ items: SetupItem[]; jobs: Record<string, SetupJob>; system?: SystemProfile }>("/api/setup/status");
}

export function startSetupInstall(id: string): Promise<SetupJob & { id: string }> {
  return apiPostJson<SetupJob & { id: string }>("/api/setup/install", { id });
}

export async function fetchSetupJob(id: string): Promise<SetupJob> {
  try {
    return await apiJson<SetupJob>(`/api/setup/job?id=${encodeURIComponent(id)}`);
  } catch {
    return { status: "unknown", log: "", progress: 0 };
  }
}

/**
 * Full install flow for one tool: starts the job and polls until ready.
 * onProgress receives the latest log line and percent.
 */
export async function runSetupInstall(
  id: string,
  onProgress?: (u: SetupJob) => void,
  timeoutMs = 60 * 60 * 1000,
): Promise<void> {
  await startSetupInstall(id);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("Setup timed out. Check the diagnostics log and try again.");
    const s = await fetchSetupJob(id);
    onProgress?.(s);
    if (s.status === "ready") return;
    if (s.status === "failed") throw new Error(s.log || "Setup failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
}
