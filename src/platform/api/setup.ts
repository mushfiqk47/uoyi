import { apiJson, apiPostJson } from "./client";

export interface SetupItem {
  id: string;
  label: string;
  required: boolean;
  installed: boolean;
  /** "app" = installed into the app bin folder, "path" = found on PATH, "missing". */
  source: "app" | "path" | "missing";
  version: string;
  note: string;
}

export interface SetupJob {
  status: string;
  log: string;
  progress: number;
}

export async function fetchSetupStatus(): Promise<{ items: SetupItem[]; jobs: Record<string, SetupJob> }> {
  return apiJson<{ items: SetupItem[]; jobs: Record<string, SetupJob> }>("/api/setup/status");
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
    if (Date.now() > deadline) throw new Error("Setup timed out. Check the dev-server terminal and try again.");
    const s = await fetchSetupJob(id);
    onProgress?.(s);
    if (s.status === "ready") return;
    if (s.status === "failed") throw new Error(s.log || "Setup failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
}
