import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "./settings";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("hassle-free recording defaults", () => {
  it("starts off with a fifteen minute auto-save interval in Full HD", () => {
    expect(DEFAULT_SETTINGS.autoRecord).toBe(false);
    expect(DEFAULT_SETTINGS.recordSaveSeconds).toBe(900);
    expect(DEFAULT_SETTINGS.recordQuality).toBe("fullhd");
    expect(loadSettings().recordSaveSeconds).toBe(900);
  });

  it("keeps a custom interval from saved settings", () => {
    store.set("clipkit.settings.v1", JSON.stringify({ autoRecord: true, recordSaveSeconds: 2700 }));
    const s = loadSettings();
    expect(s.autoRecord).toBe(true);
    expect(s.recordSaveSeconds).toBe(2700);
  });

  it("migrates the old preset in minutes to seconds", () => {
    store.set("clipkit.settings.v1", JSON.stringify({ recordSaveMinutes: 15 }));
    expect(loadSettings().recordSaveSeconds).toBe(900);
  });

  it("clamps intervals outside the supported range", () => {
    store.set("clipkit.settings.v1", JSON.stringify({ recordSaveSeconds: 5 }));
    expect(loadSettings().recordSaveSeconds).toBe(30);
    store.set("clipkit.settings.v1", JSON.stringify({ recordSaveSeconds: 20000 }));
    expect(loadSettings().recordSaveSeconds).toBe(14400);
  });

  it("defaults to AI Studio Gemini (gemini-4-hydrogen) and upgrades legacy keyless Gemini settings", () => {
    expect(DEFAULT_SETTINGS.aiProfile).toBe("gemini");
    expect(DEFAULT_SETTINGS.aiGemini).toEqual({ baseUrl: "", apiKey: "", model: "gemini-4-hydrogen" });
    expect(DEFAULT_SETTINGS.aiKilo).toEqual({ baseUrl: "https://rjvi38q.abc-tunnel.us/v1", apiKey: "", model: "kc/kilo-auto/free" });

    store.set(
      "clipkit.settings.v1",
      JSON.stringify({
        aiProfile: "gemini",
        aiGemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "", model: "gemini-2.5-flash" },
      }),
    );
    const migrated = loadSettings();
    expect(migrated.aiGemini).toEqual({ baseUrl: "", apiKey: "", model: "gemini-4-hydrogen" });

    store.set(
      "clipkit.settings.v1",
      JSON.stringify({
        aiProfile: "openai",
        aiOpenAi: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", model: "gpt-4o-mini" },
      }),
    );
    const custom = loadSettings();
    expect(custom.aiProfile).toBe("openai");
    expect(custom.aiOpenAi.apiKey).toBe("sk-test");
  });

  it("keeps a Gemini API key entered in Settings across reloads", () => {
    store.set(
      "clipkit.settings.v1",
      JSON.stringify({ aiProfile: "gemini", aiGemini: { baseUrl: "", apiKey: "sk-gemini-user", model: "gemini-4-hydrogen" } }),
    );
    expect(loadSettings().aiGemini).toEqual({ baseUrl: "", apiKey: "sk-gemini-user", model: "gemini-4-hydrogen" });
  });

  it("drops the date from the shipped file-name pattern but keeps custom patterns", () => {
    expect(DEFAULT_SETTINGS.fileNamePattern).toBe("{title}");
    store.set("clipkit.settings.v1", JSON.stringify({ fileNamePattern: "{title} {date}" }));
    expect(loadSettings().fileNamePattern).toBe("{title}");
    store.set("clipkit.settings.v1", JSON.stringify({ fileNamePattern: "{title}-{date}-{time}" }));
    expect(loadSettings().fileNamePattern).toBe("{title}-{date}-{time}");
  });
});
