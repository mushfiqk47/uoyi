import type { Project } from "../../lib/types";
import { loadJson, saveJson } from "../../lib/util";
import { STORAGE_KEYS } from "./keys";
import { deleteWorkspaceProject, fetchWorkspaceProjects, saveWorkspaceProject } from "../api/workspace";

const MAX_PROJECTS = 60;

export function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function loadSavedProjects(): Project[] {
  const raw = loadJson<Project[]>(STORAGE_KEYS.projects, []);
  if (!Array.isArray(raw)) return [];
  return sortProjects(raw.filter((p) => p && typeof p.id === "string"));
}

export function saveSavedProjects(list: Project[]): Project[] {
  const trimmed = sortProjects(list).slice(0, MAX_PROJECTS);
  saveJson(STORAGE_KEYS.projects, trimmed);
  return trimmed;
}

export function upsertLocalProject(list: Project[], project: Project): Project[] {
  const copy: Project = {
    ...project,
    createdAt: project.createdAt ?? project.updatedAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  const next = [copy, ...list.filter((p) => p.id !== project.id)];
  return saveSavedProjects(next);
}

export function removeLocalProject(list: Project[], id: string): Project[] {
  const next = list.filter((p) => p.id !== id);
  return saveSavedProjects(next);
}

export async function syncProjectsFromWorkspace(local: Project[]): Promise<Project[]> {
  try {
    const remote = await fetchWorkspaceProjects();
    if (!remote.length) return local;
    const merged = new Map<string, Project>();
    for (const p of remote) merged.set(p.id, p);
    for (const p of local) {
      const existing = merged.get(p.id);
      if (!existing || (p.updatedAt || 0) >= (existing.updatedAt || 0)) {
        merged.set(p.id, p);
      }
    }
    return saveSavedProjects(Array.from(merged.values()));
  } catch {
    return local;
  }
}

export async function persistProjectToWorkspace(project: Project): Promise<void> {
  try {
    await saveWorkspaceProject(project);
  } catch {
    /* local storage already holds the project; server sync is best-effort */
  }
}

export async function deleteProjectFromWorkspace(id: string): Promise<void> {
  try {
    await deleteWorkspaceProject(id);
  } catch {
    /* ignore when offline */
  }
}
