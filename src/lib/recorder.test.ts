import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blobs = new Map<string, Blob>();

vi.mock("./db", () => ({
  putBlob: async (key: string, blob: Blob) => { blobs.set(key, blob); },
  getBlob: async (key: string) => blobs.get(key),
  deleteBlob: async (key: string) => { blobs.delete(key); },
}));

interface FakeOptions {
  mimeType?: string;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
}

const recorders: FakeRecorder[] = [];

class FakeRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType = "video/mp4;codecs=avc1.42E01E,mp4a.40.2";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, _options: FakeOptions) {
    recorders.push(this);
  }

  static isTypeSupported(_type: string): boolean {
    return true;
  }

  start(_timeslice?: number): void {
    this.state = "recording";
  }

  stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["video chunk"], { type: "video/webm" }) });
    this.onstop?.();
  }
}

const stream = {
  getVideoTracks: () => [{ readyState: "live" }],
  getAudioTracks: () => [{ readyState: "live", enabled: true }],
} as unknown as MediaStream;

beforeEach(() => {
  blobs.clear();
  recorders.length = 0;
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: FakeRecorder });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "MediaRecorder");
  Reflect.deleteProperty(globalThis, "window");
});

describe("LiveRecorder segment saving", () => {
  it("saves when the auto-save timer completes and continues recording", async () => {
    const { LiveRecorder } = await import("./recorder");
    const segments: number[] = [];
    const rec = new LiveRecorder({ stream, segmentSeconds: 30, onSegment: (s) => { segments.push(s.seconds); } });

    expect(recorders).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toBeGreaterThan(29);
    expect(recorders).toHaveLength(2);
    rec.stop();
  });

  it("flush saves the current segment without stopping", async () => {
    const { LiveRecorder } = await import("./recorder");
    const segments: number[] = [];
    const rec = new LiveRecorder({ stream, segmentSeconds: 300, onSegment: (s) => { segments.push(s.seconds); } });

    await vi.advanceTimersByTimeAsync(10_000);
    await rec.flush();

    expect(segments).toHaveLength(1);
    expect(rec.active).toBe(true);
    expect(recorders).toHaveLength(2);
    rec.stop();
  });

  it("stop saves the final segment and does not restart", async () => {
    const { LiveRecorder } = await import("./recorder");
    const segments: number[] = [];
    const rec = new LiveRecorder({ stream, segmentSeconds: 300, onSegment: (s) => { segments.push(s.seconds); } });

    await vi.advanceTimersByTimeAsync(10_000);
    await rec.stop();

    expect(segments).toHaveLength(1);
    expect(recorders).toHaveLength(1);
  });
});
