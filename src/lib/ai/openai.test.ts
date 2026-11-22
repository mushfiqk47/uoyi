import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { VIRAL_FOCUS_PRESETS, chatCompletion, suggestClipsFromTranscript, tryParseJson } from "./openai";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tryParseJson", () => {
  it("parses a clean JSON reply", () => {
    expect(tryParseJson('{"score":9}')).toEqual({ score: 9 });
  });

  it("extracts an object wrapped in prose", () => {
    expect(tryParseJson('Here you go: {"score":7} — done')).toEqual({ score: 7 });
  });

  it("returns null for a truncated object instead of throwing", () => {
    expect(tryParseJson('Here\'s why: {"score":10')).toBeNull();
  });

  it("returns null when there is no object at all", () => {
    expect(tryParseJson("no json here")).toBeNull();
  });

  it("takes the first of two adjacent objects instead of spanning both", () => {
    expect(tryParseJson('{"a":1}{"b":2}')).toEqual({ a: 1 });
  });

  it("does not end an object on a brace inside a string", () => {
    expect(tryParseJson('note {"text":"a } brace"}')).toEqual({ text: "a } brace" });
  });
});

describe("viral clip presets and metadata parsing", () => {
  it("forwards the Gemini API key from settings through the local chat proxy", async () => {
    const payload = { choices: [{ message: { content: "connected" } }] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await chatCompletion(
      {
        ...DEFAULT_SETTINGS,
        aiProfile: "gemini",
        aiGemini: { ...DEFAULT_SETTINGS.aiGemini, apiKey: "sk-gemini-user" },
      },
      [{ role: "user", content: "hi" }],
    );

    expect(out).toBe("connected");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai/chat");
    expect(JSON.parse(String(init.body))).toMatchObject({ provider: "aistudio", apiKey: "sk-gemini-user" });
  });

  it("includes a GTA 6 Viral focus preset", () => {
    expect(VIRAL_FOCUS_PRESETS.some((p) => p.id === "gta6" && p.focus.includes("GTA 6"))).toBe(true);
  });

  it("routes AI Studio Gemini via /api/ai/chat, parses viral breakdown, and sorts descending by score", async () => {
    const payload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              clips: [
                {
                  start: 5,
                  end: 25,
                  title: "Mid moment",
                  score: 7,
                  hook: "HOLD UP",
                  whyViral: "Good payoff",
                  platforms: ["YouTube Shorts"],
                  caption: "Wait till the end",
                  hashtags: ["#gta6"],
                  editingTips: "Punch in at 3s",
                  breakdown: { hook: 7, pacing: 7, emotion: 8, shareability: 7 },
                },
                {
                  start: 40,
                  end: 72,
                  title: "5-Star Ocean Drive Chaos",
                  score: 10,
                  hook: "NO WAY THIS HAPPENED",
                  whyViral: "Immediate explosion hook and shocked scream",
                  platforms: ["TikTok", "YouTube Shorts", "Reels"],
                  caption: "GTA 6 physics went crazy",
                  hashtags: ["#GTA6", "#ViceCity", "#GamingShorts"],
                  editingTips: "Start at explosion, 1.2x zoom on facecam",
                  breakdown: { hook: 10, pacing: 9, emotion: 10, shareability: 9 },
                },
              ],
            }),
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const clips = await suggestClipsFromTranscript(
      DEFAULT_SETTINGS,
      { title: "GTA 6 Stream", transcript: "[0-80] gameplay", duration: 120 },
      { maxClips: 4, minLength: 10, maxLength: 60 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai/chat");
    const sent = JSON.parse(init.body);
    expect(sent.provider).toBe("aistudio");
    expect(sent.model).toBe("gemini-4-hydrogen");

    expect(clips).toHaveLength(2);
    expect(clips[0].score).toBe(10);
    expect(clips[0].title).toBe("5-Star Ocean Drive Chaos");
    expect(clips[0].viral.hook).toBe("NO WAY THIS HAPPENED");
    expect(clips[0].viral.hashtags).toEqual(["#GTA6", "#ViceCity", "#GamingShorts"]);
    expect(clips[0].viral.breakdown).toEqual({ hook: 10, pacing: 9, emotion: 10, shareability: 9 });
  });
});

describe("chatCompletion response shapes", () => {
  const profile = {
    ...DEFAULT_SETTINGS,
    aiProfile: "openai" as const,
    aiOpenAi: { ...DEFAULT_SETTINGS.aiOpenAi, baseUrl: "https://example.test/v1", apiKey: "test-key" },
  };

  function stubReply(payload: unknown, ok = true) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, text: async () => JSON.stringify(payload) }));
  }

  it("reads an answer from an array of content parts", async () => {
    stubReply({ choices: [{ message: { content: [{ type: "text", text: '{"ok":true}' }] } }] });
    expect(await chatCompletion(profile, [{ role: "user", content: "hi" }])).toBe('{"ok":true}');
  });

  it("reads a Responses-style output_text", async () => {
    stubReply({ output_text: "connected" });
    expect(await chatCompletion(profile, [{ role: "user", content: "hi" }])).toBe("connected");
  });

  it("uses reasoning content when the final content is empty", async () => {
    stubReply({ choices: [{ message: { content: "", reasoning_content: "thinking" }, finish_reason: "length" }] });
    expect(await chatCompletion(profile, [{ role: "user", content: "hi" }])).toBe("thinking");
  });

  it("surfaces an upstream error object returned with HTTP 200", async () => {
    stubReply({ error: { message: "This model is currently experiencing high demand" } });
    await expect(chatCompletion(profile, [{ role: "user", content: "hi" }])).rejects.toThrow(/high demand/);
  });

  it("names the finish reason when the model returns no content", async () => {
    stubReply({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
    await expect(chatCompletion(profile, [{ role: "user", content: "hi" }])).rejects.toThrow(/finish reason: length/);
  });
});
