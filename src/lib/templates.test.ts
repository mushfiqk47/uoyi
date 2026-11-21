import { describe, expect, it } from "vitest";
import { PREMADE_TEMPLATES, missingPremadeTemplates } from "./templates";

describe("premade templates", () => {
  it("provides curated presets with unique IDs and valid ranges", () => {
    expect(PREMADE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(PREMADE_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(PREMADE_TEMPLATES.length);

    for (const t of PREMADE_TEMPLATES) {
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(["fill", "fit", "split"]).toContain(t.layout.mode);
      expect(["bebas", "tiktok", "inter"]).toContain(t.captionStyle.font);
      expect(t.layout.facecamShare).toBeGreaterThanOrEqual(0.2);
      expect(t.layout.facecamShare).toBeLessThanOrEqual(0.6);
    }
  });

  it("returns only missing presets without duplicating existing ones", () => {
    const first = PREMADE_TEMPLATES[0];
    const missing = missingPremadeTemplates([first]);
    expect(missing.some((t) => t.id === first.id)).toBe(false);
    expect(missing.length).toBe(PREMADE_TEMPLATES.length - 1);
  });
});
