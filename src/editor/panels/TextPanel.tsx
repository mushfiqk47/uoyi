import { Plus, Trash2, Type } from "lucide-react";
import type { Project, TextItem } from "../../lib/types";
import { useStore } from "../../store";
import { projectDuration } from "../../lib/project";
import { ColorField, Field, NumberInput, Range, Seg, Switch } from "../../components/ui";
import { clamp, fmtTime, uid } from "../../lib/util";
import type { Player } from "../player";
import type { Selection } from "../Timeline";
import { FONT_OPTIONS, Row, Section, StackField } from "./shared";

export function TextPanel({
  project,
  player,
  selection,
  onSelect,
}: {
  project: Project;
  player: Player;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { editProject } = useStore();
  const sel = selection?.kind === "text" ? project.texts.find((t) => t.id === selection.id) : undefined;
  const duration = projectDuration(project);

  const add = () => {
    const start = Math.min(player.clock.time, Math.max(0, duration - 0.5));
    const t: TextItem = {
      id: uid("t"),
      text: "Wait for it…",
      start,
      end: Math.min(Math.max(duration, start + 0.5), start + 3),
      x: 0.5,
      y: 0.7,
      size: 72,
      color: "#ffffff",
      font: "tiktok",
      stroke: false,
      background: true,
      backgroundColor: "#000000",
    };
    editProject((p) => ({ ...p, texts: [...p.texts, t] }));
    onSelect({ kind: "text", id: t.id });
  };
  const set = (patch: Partial<TextItem>, key: string) =>
    sel && editProject((p) => ({ ...p, texts: p.texts.map((t) => (t.id === sel.id ? { ...t, ...patch } : t)) }), `${key}-${sel.id}`);

  return (
    <>
      <Section title="Text" aside={<button className="btn accent sm" onClick={add} disabled={duration <= 0}><Plus className="ic" /> Add text</button>}>
        {project.texts.length === 0 ? (
          <p className="insp-help">Add a hook, a title or a call to action. It appears at the playhead for three seconds; drag it on the timeline to move it.</p>
        ) : (
          <div className="pick-list">
            {project.texts.map((t) => (
              <button key={t.id} className={`pick${sel?.id === t.id ? " on" : ""}`} onClick={() => { onSelect({ kind: "text", id: t.id }); player.seek(t.start); }}>
                <Type className="ic" />
                <span className="grow">{t.text || "Text"}</span>
                <em className="tabular">{fmtTime(t.start)}</em>
              </button>
            ))}
          </div>
        )}
      </Section>
      <Section
        title="Selected text"
        aside={sel ? <button className="btn plain icon sm" aria-label="Delete text" onClick={() => { editProject((p) => ({ ...p, texts: p.texts.filter((t) => t.id !== sel.id) })); onSelect(null); }}><Trash2 className="ic" /></button> : undefined}
      >
        {sel ? (
          <>
            <textarea className="textarea insp-transcript" rows={2} value={sel.text} onChange={(e) => set({ text: e.target.value }, "tt")} aria-label="Text" />
            <StackField label="Font">
              <Seg full label="Font" value={sel.font} onChange={(font) => set({ font }, "tf")} options={FONT_OPTIONS} />
            </StackField>
            <Row label="Size">
              <Range label="Text size" value={sel.size} min={28} max={180} step={1} onChange={(v) => set({ size: v }, "ts")} />
              <span className="val tabular">{sel.size}</span>
            </Row>
            <Row label="Left / right">
              <Range label="Horizontal position" value={sel.x} min={0.1} max={0.9} onChange={(v) => set({ x: v }, "tx")} />
              <span className="val tabular">{Math.round(sel.x * 100)}%</span>
            </Row>
            <Row label="Up / down">
              <Range label="Vertical position" value={sel.y} min={0.05} max={0.95} onChange={(v) => set({ y: v }, "ty")} />
              <span className="val tabular">{Math.round(sel.y * 100)}%</span>
            </Row>
            <div className="insp-mini-grid">
              <div className="insp-mini-item">
                <span>Colour</span>
                <ColorField label="Text colour" value={sel.color} onChange={(v) => set({ color: v }, "tc")} />
              </div>
              <div className="insp-mini-item">
                <span>Background</span>
                <Switch label="Background" checked={sel.background} onChange={(v) => set({ background: v }, "tb")} />
              </div>
              <div className="insp-mini-item">
                <span>Bg colour</span>
                <ColorField
                  label="Background colour"
                  value={sel.backgroundColor || "#000000"}
                  onChange={(v) => set({ backgroundColor: v, background: true }, "tbgc")}
                />
              </div>
              <div className="insp-mini-item">
                <span>Outline</span>
                <Switch label="Outline" checked={sel.stroke} onChange={(v) => set({ stroke: v }, "tst")} />
              </div>
            </div>
            <div className="two">
              <Field label="Starts at">
                <NumberInput label="Starts at" value={sel.start} step={0.1} min={0} suffix="s" onChange={(v) => set({ start: clamp(v, 0, sel.end - 0.2) }, "tstart")} />
              </Field>
              <Field label="Ends at">
                <NumberInput label="Ends at" value={sel.end} step={0.1} suffix="s" onChange={(v) => set({ end: Math.max(v, sel.start + 0.2) }, "tend")} />
              </Field>
            </div>
          </>
        ) : (
          <p className="insp-help">Select a text item from the list or in the timeline to edit font, position, color, and timing.</p>
        )}
      </Section>
    </>
  );
}
