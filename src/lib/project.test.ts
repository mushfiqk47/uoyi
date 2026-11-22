import { describe, expect, it } from "vitest";
import { activeClipAt, clipLength, clipStarts, fileNameFor, hookTextItem, hookTileText, postCopyText, projectDuration, splitVideoClipAt, withoutVideoClip } from "./project";
import type { Clip, Project, VClip } from "./types";

const clip = (id: string, inde: number, out: number, speed = 1): VClip => ({
  id, mediaId: "m", in: inde, out, speed, volume: 0,
});

const proj = (video: VClip[] = []): Project => ({
  version: 1, id: "p", name: "test", clipId: null, media: [], video, music: [], captions: [],
  templateId: null, updatedAt: 0,
  layout: { mode: "fill", zoom: 1, panX: 0, panY: 0, facecam: { x: 0.68, y: 0.04, w: 0.3, h: 0.3 }, facecamShare: 0.38 },
  captionStyle: { font: "bebas", size: 112, color: "#fff", highlight: "#38bdf8", stroke: true, caps: true, y: 0.7, wordsPerLine: 3, background: false },
  overlay: { platform: "off", name: "n", caption: "", song: "", likes: 0, comments: 0, shares: 0, saves: 0, verified: false },
  texts: [],
});

describe("post copy text", () => {
  const fixture = (overrides: Partial<Clip> = {}): Clip => ({
    id: "c", mediaId: "m", blobKey: "b", streamTitle: "t", capturedAt: 0, seconds: 20,
    in: 0, duration: 20, width: 1080, height: 1920, thumb: null, note: "",
    favourite: false, edited: false, renderedAt: null, removedAt: null,
    ...overrides,
  });
  const viral = (caption: string, hashtags: string[]) => ({ caption, hashtags, hook: "", whyViral: "", platforms: [], editingTips: "" });

  it("puts the caption on one line and hashtags on the next", () => {
    expect(postCopyText(fixture({ viral: viral("He did WHAT?", ["#funny", "#gta6"]) }))).toBe("He did WHAT?\n#funny #gta6");
  });

  it("returns nothing when there is no AI copy", () => {
    expect(postCopyText(fixture())).toBe("");
    expect(postCopyText(fixture({ viral: viral("", []) }))).toBe("");
  });

  it("shortens the hook to six words and adds one emoji", () => {
    const v = viral("", []);
    v.hook = "he put the doctor in the trunk?! 🔥";
    expect(hookTileText(fixture({ viral: v }))).toBe("HE PUT THE DOCTOR IN THE 🔥");
  });

  it("keeps a single emoji from the hook and drops extra ones", () => {
    const v = viral("", []);
    v.hook = "wait for it 💀 😂 now you will see this";
    expect(hookTileText(fixture({ viral: v }))).toBe("WAIT FOR IT NOW YOU WILL 💀");
  });

  it("makes a boundary text layer that spans the clip", () => {
    const v = viral("", []);
    v.hook = "no way";
    const item = hookTextItem(fixture({ viral: v, in: 10, duration: 30 }));
    expect(item).toMatchObject({ text: "NO WAY 🔥", x: 0.5, y: 0.7, start: 0, end: 20 });
  });

  it("returns no text layer when there is no hook", () => {
    expect(hookTileText(fixture())).toBe("");
    expect(hookTextItem(fixture())).toBeNull();
  });
});

describe("clipLength", () => {
  it("divides source length by speed", () => {
    expect(clipLength(clip("a", 0, 10, 2))).toBe(5);
  });
  it("never returns less than one frame-ish floor", () => {
    expect(clipLength(clip("a", 5, 5))).toBe(0.05);
  });
});

describe("projectDuration", () => {
  it("sums video clips", () => {
    expect(projectDuration(proj([clip("a", 0, 10), clip("b", 5, 15)]))).toBe(20);
  });
  it("falls back to the music lane when there is no video", () => {
    const p = proj();
    p.music = [{ id: "m", mediaId: "x", start: 4, in: 0, out: 8, volume: 1 }];
    expect(projectDuration(p)).toBe(12);
  });
  it("is zero for an empty project", () => {
    expect(projectDuration(proj())).toBe(0);
  });
});

describe("clipStarts", () => {
  it("places each clip after the previous one", () => {
    expect(clipStarts(proj([clip("a", 0, 10), clip("b", 0, 5, 2), clip("c", 0, 4)]))).toEqual([0, 10, 12.5]);
  });
});

describe("activeClipAt", () => {
  it("maps timeline time to source time at 1x", () => {
    const a = activeClipAt(proj([clip("a", 2, 12)]), 3);
    expect(a?.index).toBe(0);
    expect(a?.local).toBe(5); // in point (2) + 3s into the clip
  });

  it("accounts for speed when entering the second clip", () => {
    const a = activeClipAt(proj([clip("a", 0, 10), clip("b", 5, 15, 2)]), 12);
    expect(a?.index).toBe(1);
    expect(a?.local).toBe(9); // 5 + (12 - 10) * 2
  });

  it("returns null past the end of the timeline", () => {
    expect(activeClipAt(proj([clip("a", 0, 10)]), 11)).toBeNull();
  });

  it("returns null for an empty timeline", () => {
    expect(activeClipAt(proj(), 0)).toBeNull();
  });
});

describe("withoutVideoClip", () => {
  const withAudio = () => {
    const p = proj([clip("a", 0, 10), clip("b", 0, 5, 1)]);
    p.media = [
      { id: "m", name: "a.mp4", kind: "video", duration: 10, width: 1920, height: 1080, blobKey: "clip:a" },
      { id: "m2", name: "b.mp4", kind: "video", duration: 5, width: 1920, height: 1080, blobKey: "clip:b" },
    ];
    p.video[1].mediaId = "m2";
    p.music = [
      { id: "auto-a", mediaId: "m", start: 0, in: 0, out: 10, volume: 1, auto: true },
      { id: "auto-b", mediaId: "m2", start: 0, in: 0, out: 5, volume: 1, auto: true },
      { id: "user", mediaId: "m", start: 2, in: 1, out: 3, volume: 0.5 },
    ];
    return p;
  };

  it("drops the mirrored sound when its video clip goes", () => {
    const next = withoutVideoClip(withAudio(), "a");
    expect(next.video.map((v) => v.id)).toEqual(["b"]);
    expect(next.music.map((m) => m.id)).toEqual(["auto-b", "user"]);
  });

  it("keeps the mirrored sound while another clip still uses that media", () => {
    const p = withAudio();
    p.video = [...p.video, { ...p.video[0], id: "a2" }];
    const next = withoutVideoClip(p, "a");
    expect(next.music.some((m) => m.id === "auto-a")).toBe(true);
  });

  it("ignores an unknown clip id", () => {
    const p = withAudio();
    expect(withoutVideoClip(p, "nope")).toBe(p);
  });
});

describe("splitVideoClipAt", () => {
  it("splits both video and mirrored auto audio at timeline time respecting speed", () => {
    const p = proj([clip("a", 2, 12, 2)]);
    p.music = [
      { id: "auto-a", mediaId: "m", start: 0, in: 2, out: 12, volume: 1, auto: true },
      { id: "bg", mediaId: "other", start: 0, in: 0, out: 10, volume: 0.4 },
    ];
    let n = 0;
    const res = splitVideoClipAt(p, 2, (prefix) => `${prefix}${++n}`);
    expect(res).not.toBeNull();
    expect(res!.selectedId).toBe("v1");
    expect(res!.project.video.map((v) => [v.id, v.in, v.out])).toEqual([
      ["a", 2, 6],
      ["v1", 6, 12],
    ]);
    expect(res!.project.music.map((m) => [m.id, m.start, m.in, m.out])).toEqual([
      ["auto-a", 0, 2, 6],
      ["a2", 2, 6, 12],
      ["bg", 0, 0, 10],
    ]);
  });

  it("refuses to split too close to clip edges", () => {
    const p = proj([clip("a", 0, 5)]);
    expect(splitVideoClipAt(p, 0.05)).toBeNull();
    expect(splitVideoClipAt(p, 4.95)).toBeNull();
  });

  it("removes only the matching split auto audio slice and shifts subsequent auto tracks", () => {
    const p = proj([clip("a", 0, 10)]);
    p.music = [{ id: "auto-a", mediaId: "m", start: 0, in: 0, out: 10, volume: 1, auto: true }];
    let n = 0;
    const split = splitVideoClipAt(p, 4, (prefix) => `${prefix}${++n}`)!;
    const after = withoutVideoClip(split.project, "a");
    expect(after.video.map((v) => v.id)).toEqual(["v1"]);
    expect(after.music).toEqual([{ id: "a2", mediaId: "m", start: 0, in: 4, out: 10, volume: 1, auto: true }]);
  });
});

describe("fileNameFor", () => {
  it("substitutes the title", () => {
    expect(fileNameFor("{title} edit", "Clip One")).toBe("Clip One edit");
  });
  it("falls back to the title for a blank pattern", () => {
    expect(fileNameFor("  ", "Only Title")).toBe("Only Title");
  });
});
