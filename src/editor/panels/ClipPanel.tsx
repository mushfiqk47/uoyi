import { ArrowLeft, ArrowRight, Trash2, X } from "lucide-react";
import type { Project } from "../../lib/types";
import { useStore } from "../../store";
import { clipStarts, withoutVideoClip } from "../../lib/project";
import { Field, NumberInput, Range, Seg } from "../../components/ui";
import { clamp } from "../../lib/util";
import type { Player } from "../player";
import type { Selection } from "../Timeline";
import { Row, Section, StackField } from "./shared";

export function ClipPanel({
  project,
  selection,
  onSelect,
  player,
}: {
  project: Project;
  selection: Selection;
  onSelect: (s: Selection) => void;
  player: Player;
}) {
  const { editProject } = useStore();
  if (selection?.kind === "music") {
    const c = project.music.find((x) => x.id === selection.id);
    if (!c) return null;
    const m = project.media.find((x) => x.id === c.mediaId);
    const set = (patch: Partial<typeof c>, key: string) => editProject((p) => ({ ...p, music: p.music.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }), `${key}-${c.id}`);
    return (
      <Section
        title={`Selected audio · ${m?.name ?? "Sound"}`}
        aside={
          <div className="row">
            <button className="btn plain icon sm" aria-label="Delete sound" title="Delete sound" onClick={() => { editProject((p) => ({ ...p, music: p.music.filter((x) => x.id !== c.id) })); onSelect(null); }}><Trash2 className="ic" /></button>
            <button className="btn plain icon sm" aria-label="Deselect sound" title="Close selection" onClick={() => onSelect(null)}><X className="ic" /></button>
          </div>
        }
      >
        <div className="clip-panel-grid">
          <Row label="Volume">
            <Range label="Volume" value={c.volume} min={0} max={1} onChange={(v) => set({ volume: v }, "mv")} />
            <span className="val tabular">{Math.round(c.volume * 100)}%</span>
          </Row>
          <div className="two">
            <Field label="Starts at">
              <NumberInput label="Starts at" value={c.start} step={0.1} min={0} suffix="s" onChange={(v) => set({ start: Math.max(0, v) }, "ms")} />
            </Field>
            <Field label="Length">
              <NumberInput label="Length" value={c.out - c.in} step={0.1} min={0.2} suffix="s" onChange={(v) => set({ out: clamp(c.in + v, c.in + 0.2, m?.duration ?? c.out) }, "ml")} />
            </Field>
          </div>
        </div>
      </Section>
    );
  }
  if (selection?.kind !== "video") return null;
  const i = project.video.findIndex((x) => x.id === selection.id);
  const c = project.video[i];
  if (!c) return null;
  const m = project.media.find((x) => x.id === c.mediaId);
  const set = (patch: Partial<typeof c>, key: string) => editProject((p) => ({ ...p, video: p.video.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }), `${key}-${c.id}`);
  const move = (d: -1 | 1) =>
    editProject((p) => {
      const v = [...p.video];
      const k = i + d;
      if (k < 0 || k >= v.length) return p;
      [v[i], v[k]] = [v[k], v[i]];
      return { ...p, video: v };
    });
  return (
    <Section
      title={`Selected clip · ${m?.name ?? "Clip"}`}
      aside={
        <div className="row">
          <button className="btn ghost sm" onClick={() => player.seek(clipStarts(project)[i])}>
            Jump to clip
          </button>
          <button className="btn plain icon sm" aria-label="Move earlier" title="Move earlier" disabled={i === 0} onClick={() => move(-1)}><ArrowLeft className="ic" /></button>
          <button className="btn plain icon sm" aria-label="Move later" title="Move later" disabled={i === project.video.length - 1} onClick={() => move(1)}><ArrowRight className="ic" /></button>
          <button className="btn plain icon sm" aria-label="Delete clip" title="Delete clip" onClick={() => { editProject((p) => withoutVideoClip(p, c.id)); onSelect(null); }}><Trash2 className="ic" /></button>
          <button className="btn plain icon sm" aria-label="Deselect clip" title="Close selection" onClick={() => onSelect(null)}><X className="ic" /></button>
        </div>
      }
    >
      <div className="clip-panel-grid">
        <div className="clip-panel-col">
          <StackField label="Speed">
            <Seg full label="Speed" value={c.speed} onChange={(v) => set({ speed: v }, "sp")} options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: `${v}×` }))} />
          </StackField>
          {m?.kind === "video" && (
            <Row label="Volume">
              <Range label="Volume" value={c.volume} min={0} max={1} onChange={(v) => set({ volume: v }, "vv")} />
              <span className="val tabular">{Math.round(c.volume * 100)}%</span>
            </Row>
          )}
        </div>
        <div className="two">
          <Field label="From (in source)">
            <NumberInput label="From" value={c.in} step={0.1} min={0} suffix="s" onChange={(v) => set({ in: clamp(v, 0, c.out - 0.1) }, "in")} />
          </Field>
          <Field label="To">
            <NumberInput label="To" value={c.out} step={0.1} suffix="s" onChange={(v) => set({ out: clamp(v, c.in + 0.1, m?.kind === "image" ? 600 : (m?.duration ?? v)) }, "out")} />
          </Field>
        </div>
      </div>
    </Section>
  );
}
