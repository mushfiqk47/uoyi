import { apiJson, apiPostJson } from "./client";
import type { Project } from "../../lib/types";

export interface WorkspaceSummary {
  dataDir: string;
  workspaceDir: string;
  autoSaveExports: boolean;
  dirs: {
    root: string;
    projects: string;
    recordings: string;
    clips: string;
    exports: string;
    media: string;
  };
  disk: {
    freeBytes: number;
    totalBytes: number;
  } | null;
  counts: {
    projects: number;
    media: number;
  };
}

export interface WorkspaceMediaRecord {
  id: string;
  title: string;
  file: string;
  mime: string;
  kind: "video" | "audio" | "image";
  source: string;
  duration: number;
  sizeBytes: number;
  createdAt: number;
  streamUrl: string;
}

export interface SecretsStatus {
  gemini: boolean;
  openai: boolean;
  kilo: boolean;
  cloud: boolean;
}

export interface DiagnosticsReport {
  generatedAt: string;
  appVersion: string;
  setup: unknown;
  workspace: WorkspaceSummary | null;
  logFile: string;
  logs: string[];
}

export function fetchWorkspaceConfig(): Promise<WorkspaceSummary> {
  return apiJson<WorkspaceSummary>("/api/workspace/config");
}

export function saveWorkspaceConfig(patch: { workspaceDir?: string; autoSaveExports?: boolean }): Promise<WorkspaceSummary> {
  return apiPostJson<WorkspaceSummary>("/api/workspace/config", patch);
}

export async function fetchWorkspaceProjects(): Promise<Project[]> {
  const res = await apiJson<{ projects?: Project[] }>("/api/workspace/projects");
  return Array.isArray(res?.projects) ? res.projects : [];
}

export function saveWorkspaceProject(project: Project): Promise<{ ok: boolean; project: Project }> {
  return apiPostJson<{ ok: boolean; project: Project }>("/api/workspace/projects", { project });
}

export function deleteWorkspaceProject(id: string): Promise<{ ok: boolean; removed: boolean }> {
  return apiPostJson<{ ok: boolean; removed: boolean }>("/api/workspace/projects/delete", { id });
}

export async function fetchWorkspaceMedia(): Promise<WorkspaceMediaRecord[]> {
  const res = await apiJson<{ media?: WorkspaceMediaRecord[] }>("/api/workspace/media");
  return Array.isArray(res?.media) ? res.media : [];
}

export function deleteWorkspaceMedia(id: string): Promise<{ ok: boolean; removed: boolean }> {
  return apiPostJson<{ ok: boolean; removed: boolean }>("/api/workspace/media/delete", { id });
}

export async function fetchSecretsStatus(): Promise<SecretsStatus> {
  const res = await apiJson<{ configured?: SecretsStatus }>("/api/workspace/secrets");
  return res?.configured ?? { gemini: false, openai: false, kilo: false, cloud: false };
}

export async function saveWorkspaceSecrets(patch: Partial<Record<"gemini" | "openai" | "kilo" | "cloud", string>>): Promise<SecretsStatus> {
  const res = await apiPostJson<{ ok: boolean; configured: SecretsStatus }>("/api/workspace/secrets", { secrets: patch });
  return res.configured;
}

export function fetchDiagnostics(): Promise<DiagnosticsReport> {
  return apiJson<DiagnosticsReport>("/api/diagnostics");
}
