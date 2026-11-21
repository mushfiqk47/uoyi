import { Field } from "../../components/ui";
import type { FindClipsOptions } from "../../lib/ai/findClips";
import { VIRAL_FOCUS_PRESETS } from "../../lib/ai/openai";

export interface ClipFinderValues {
  maxClips: number | "auto";
  minScore: number | "auto";
  minLength: number | "auto";
  maxLength: number | "auto";
  focus: string;
}

export const DEFAULT_CLIP_FINDER: ClipFinderValues = {
  maxClips: "auto",
  minScore: 7,
  minLength: "auto",
  maxLength: "auto",
  focus: "",
};

export interface ClipFinderLimits {
  /** Hard ceiling on saved clips, regardless of the chosen or AI-picked count. */
  maxClips?: number;
  /** Hard floor on the score, so a weak moment is never saved. */
  minScore?: number;
}

/** Stream recordings are long, so the finder is stricter: four clips at most and only
 *  moments stronger than 7/10. One qualifying moment is enough — there is no minimum count. */
export const RECORDING_MAX_CLIPS = 4;
export const RECORDING_MIN_SCORE = 8;
export const RECORDING_CLIP_LIMITS: ClipFinderLimits = { maxClips: RECORDING_MAX_CLIPS, minScore: RECORDING_MIN_SCORE };

export const RECORDING_CLIP_FINDER: ClipFinderValues = {
  ...DEFAULT_CLIP_FINDER,
  maxClips: RECORDING_MAX_CLIPS,
  minScore: RECORDING_MIN_SCORE,
};

/** Turns the form into the pipeline options. Auto values are explicit so the AI can pick. */
export function clipFinderOptions(value: ClipFinderValues, threshold: number, limits: ClipFinderLimits = {}): FindClipsOptions {
  const autoCount = value.maxClips === "auto";
  const autoLength = value.minLength === "auto" || value.maxLength === "auto";
  const wanted = value.maxClips === "auto" ? 8 : value.maxClips;
  const maxClips = limits.maxClips ? Math.min(wanted, limits.maxClips) : wanted;
  const wantedScore = value.minScore === "auto" ? threshold : value.minScore;
  const minScore = limits.minScore ? Math.max(wantedScore, limits.minScore) : wantedScore;
  return {
    maxClips,
    minLength: value.minLength === "auto" ? 10 : value.minLength,
    maxLength: value.maxLength === "auto" ? 60 : value.maxLength,
    minScore,
    focus: value.focus.trim(),
    autoCount,
    autoLength,
  };
}

export function clipFinderError(value: ClipFinderValues): string | null {
  if (value.minLength === "auto" || value.maxLength === "auto") return null;
  return value.minLength >= value.maxLength ? "Minimum length must be smaller than maximum length." : null;
}

export function ClipFinderFields({
  value,
  onChange,
  disabled,
  scoreAuto = false,
  limits,
}: {
  value: ClipFinderValues;
  onChange: (next: ClipFinderValues) => void;
  disabled?: boolean;
  /** Show the "Auto (AI chooses)" score entry. Settings supplies the threshold. */
  scoreAuto?: boolean;
  /** Restrict the picker to values the pipeline will actually honor. */
  limits?: ClipFinderLimits;
}) {
  const set = (patch: Partial<ClipFinderValues>) => onChange({ ...value, ...patch });
  const clipCounts = [1, 2, 3, 4, 5, 6, 8, 10, 12].filter((n) => !limits?.maxClips || n <= limits.maxClips);
  const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => !limits?.minScore || n >= limits.minScore);
  return (
    <>
      <div className="two">
        <Field label="Max clips">
          <select className="select" value={value.maxClips} onChange={(e) => set({ maxClips: e.target.value === "auto" ? "auto" : Number(e.target.value) })} disabled={disabled}>
            <option value="auto">Auto (AI chooses{limits?.maxClips ? `, up to ${limits.maxClips}` : ""})</option>
            {clipCounts.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Minimum score">
          <select className="select" value={value.minScore} onChange={(e) => set({ minScore: e.target.value === "auto" ? "auto" : Number(e.target.value) })} disabled={disabled}>
            {scoreAuto && <option value="auto">Auto (Settings threshold)</option>}
            {scores.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Min seconds">
          <select className="select" value={value.minLength} onChange={(e) => set({ minLength: e.target.value === "auto" ? "auto" : Number(e.target.value) })} disabled={disabled}>
            <option value="auto">Auto (AI chooses)</option>
            {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((n) => (
              <option key={n} value={n}>{n} s</option>
            ))}
          </select>
        </Field>
        <Field label="Max seconds">
          <select className="select" value={value.maxLength} onChange={(e) => set({ maxLength: e.target.value === "auto" ? "auto" : Number(e.target.value) })} disabled={disabled}>
            <option value="auto">Auto (AI chooses)</option>
            {[15, 30, 45, 60, 90, 120, 180, 240, 300].map((n) => (
              <option key={n} value={n}>{n} s</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Focus (optional)" hint={`Tell the AI which moments to look for. Only moments scoring at least ${limits?.minScore ?? "the minimum"} are saved.`}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {VIRAL_FOCUS_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`btn sm ${value.focus === p.focus ? "accent" : "ghost"}`}
              onClick={() => set({ focus: value.focus === p.focus ? "" : p.focus })}
              disabled={disabled}
            >
              {p.label}
            </button>
          ))}
        </div>
        <textarea className="textarea" rows={2} placeholder="GTA 6 police chases, insane stunts, loud streamer reactions, hidden easter eggs…" value={value.focus} onChange={(e) => set({ focus: e.target.value })} disabled={disabled} />
      </Field>
    </>
  );
}
