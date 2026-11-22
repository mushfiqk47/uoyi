import { describe, expect, it, beforeEach, vi } from "vitest";
import { loadSavedProjects, removeLocalProject, saveSavedProjects, upsertLocalProject } from "./projectRepository";
import { fileNameFor, lookFromSettings, newProject } from "../../lib/project";
import { isLocalhostUrl, suggestTitle } from "../../lib/ai/openai";
import { DEFAULT_SETTINGS } from "../../lib/settings";

describe("projectRepository & privacy helpers", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("saves, updates, sorts, and deletes saved projects in localStorage", () => {
    const look = lookFromSettings(DEFAULT_SETTINGS, []);
    const p1 = newProject("Alpha", look, []);
    const p2 = newProject("Beta", look, []);
    p1.updatedAt = 100;
    p2.updatedAt = 200;
    saveSavedProjects([p1, p2]);
    expect(loadSavedProjects().map((p) => p.name)).toEqual(["Beta", "Alpha"]);

    const next = upsertLocalProject(loadSavedProjects(), { ...p1, name: "Alpha v2" });
    expect(next[0].name).toBe("Alpha v2");
    const afterRemove = removeLocalProject(next, p2.id);
    expect(afterRemove.map((p) => p.name)).toEqual(["Alpha v2"]);
  });

  it("sanitizes output filenames for cross-platform safety", () => {
    expect(fileNameFor("{title}", 'Test: Clip?/"1"')).toBe("Test- Clip-1");
    expect(fileNameFor("{title}", "CON")).toBe("clip");
  });

  it("identifies localhost URLs and blocks remote AI calls when localOnlyMode is active", async () => {
    expect(isLocalhostUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalhostUrl("http://localhost:8081")).toBe(true);
    expect(isLocalhostUrl("https://api.openai.com/v1")).toBe(false);

    const localOnlySettings = { ...DEFAULT_SETTINGS, localOnlyMode: true, aiProfile: "gemini" as const };
    await expect(suggestTitle(localOnlySettings, { transcript: "hello world" })).rejects.toThrow(/Local-Only Mode/i);
  });
});
