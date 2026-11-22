import type { ClipPick } from "./findClips";

/** Minimal scene span; structurally matches the API's SceneSpan so the pure helpers stay
 *  decoupled from the client API module. */
export interface SceneSpanLike {
  start: number;
  end: number;
  duration: number;
}

export const SCENE_SNAP_MAX_DELTA = 2;

/** Nearest scene-change timestamp within maxDelta, else the input unchanged. */
export function snapToSceneBoundary(t: number, scenes: SceneSpanLike[], maxDelta = SCENE_SNAP_MAX_DELTA): number {
  let best = t;
  let bestDist = maxDelta;
  for (const s of scenes) {
    const dist = Math.abs(s.start - t);
    if (dist < bestDist) {
      bestDist = dist;
      best = s.start;
    }
  }
  return best;
}

/** Moves every pick's start onto the nearest visual scene change (within a small tolerance) so
 *  cuts open on a clean boundary instead of mid-action. End times are re-clamped so the pick
 *  keeps a usable length. Kept pure for tests. */
export function snapPicksToScenes(picks: ClipPick[], scenes: SceneSpanLike[], minKeep = 5): ClipPick[] {
  if (!scenes.length) return picks;
  return picks.map((p) => {
    const start = snapToSceneBoundary(p.start, scenes);
    const end = Math.max(p.end, start + minKeep);
    return { ...p, start, end };
  });
}

/** Minimal silence span; matches `/api/analyze` silences for snapping cleanly around dead air. */
export interface SilenceSpanLike {
  start: number;
  end: number;
  duration?: number;
}

/** Formats scene-change starts as a compact seconds list for the clip-finder prompt. */
export function sceneStartsForPrompt(scenes: SceneSpanLike[], maxPoints = 250): string {
  const starts = scenes
    .map((s) => Math.round(s.start * 10) / 10)
    .sort((a, b) => a - b)
    .filter((v, i, a) => i === 0 || v !== a[i - 1])
    .slice(0, maxPoints);
  return starts.join(", ");
}

/** Temporal Intersection-over-Union Non-Maximum Suppression: keeps higher-scoring clips and
 *  drops duplicates from sliding transcript windows whose overlap exceeds `maxIoU`. */
export function dedupeOverlappingPicks<T extends Pick<ClipPick, "start" | "end" | "score">>(
  picks: T[],
  maxIoU = 0.35,
): T[] {
  const sorted = [...picks].sort((a, b) => b.score - a.score || a.start - b.start);
  const kept: T[] = [];
  for (const cand of sorted) {
    const cLen = Math.max(0.05, cand.end - cand.start);
    const overlaps = kept.some((k) => {
      const inter = Math.max(0, Math.min(cand.end, k.end) - Math.max(cand.start, k.start));
      if (inter <= 0) return false;
      const union = cLen + Math.max(0.05, k.end - k.start) - inter;
      return union > 0 && inter / union > maxIoU;
    });
    if (!overlaps) kept.push(cand);
  }
  return kept;
}

/** Snaps pick start/end to nearby visual scene cuts and audio silence boundaries so clips
 *  open after dead air or right on a cut, and end cleanly before silence gaps. */
export function snapPicksToSignals<T extends Pick<ClipPick, "start" | "end">>(
  picks: T[],
  scenes: SceneSpanLike[],
  silences: SilenceSpanLike[] = [],
  minKeep = 5,
): T[] {
  if (!scenes.length && !silences.length) return picks;
  return picks.map((p) => {
    let start = p.start;
    const sceneStart = scenes.length ? snapToSceneBoundary(p.start, scenes, SCENE_SNAP_MAX_DELTA) : p.start;
    if (sceneStart !== p.start) {
      start = sceneStart;
    } else if (silences.length) {
      // Snap start to just after a nearby silence gap ends (speech resumes) within 1.5s.
      let best = start;
      let bestDist = 1.5;
      for (const sil of silences) {
        const d = Math.abs(sil.end - p.start);
        if (d < bestDist) {
          bestDist = d;
          best = sil.end;
        }
      }
      start = best;
    }
    let end = p.end;
    if (silences.length) {
      // Snap end to a nearby silence start (clean sentence/moment finish) within 2s.
      let bestEnd = end;
      let bestDist = 2;
      for (const sil of silences) {
        const d = Math.abs(sil.start - p.end);
        if (d < bestDist && sil.start >= start + minKeep) {
          bestDist = d;
          bestEnd = sil.start;
        }
      }
      end = bestEnd;
    }
    end = Math.max(end, start + minKeep);
    return { ...p, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) };
  });
}
