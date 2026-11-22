import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, FileUp, Sparkles, Trash2 } from "lucide-react";
import type { CaptionWord, Project } from "../../lib/types";
import { useStore } from "../../store";
import { projectDuration } from "../../lib/project";
import { ColorField, NumberInput, Range, Seg, Switch } from "../../components/ui";
import { uid } from "../../lib/util";
import { getBlob } from "../../lib/db";
import { generateCaptionsForBlob } from "../../lib/ai/captions";
import { parseSubtitles } from "../../lib/subtitles";
import type { Player } from "../player";
import type { Selection } from "../Timeline";
import { FONT_OPTIONS, Row, Section, StackField } from "./shared";

export function CaptionsPanel({
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
  const { editProject, toast, settings } = useStore();
  const s = project.captionStyle;
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<typeof s>, key: string) => editProject((p) => ({ ...p, captionStyle: { ...p.captionStyle, ...patch } }), key);
  const words = useMemo(() => [...project.captions].sort((a, b) => a.start - b.start), [project.captions]);
  const duration = projectDuration(project);

  const CAPTION_PRESETS = [
    { id: "shorts", name: "Shorts pop", patch: { font: "bebas" as const, size: 59, color: "#ffffff", highlight: "#facc15", stroke: true, caps: true, y: 0.72, wordsPerLine: 3, background: false } },
    { id: "tiktok", name: "TikTok clean", patch: { font: "tiktok" as const, size: 46, color: "#ffffff", highlight: "#38bdf8", stroke: false, caps: false, y: 0.78, wordsPerLine: 4, background: true } },
    { id: "bold", name: "Bold karaoke", patch: { font: "inter" as const, size: 52, color: "#ffffff", highlight: "#22c55e", stroke: true, caps: false, y: 0.68, wordsPerLine: 3, background: false } },
    { id: "minimal", name: "Minimal", patch: { font: "inter" as const, size: 38, color: "#ffffff", highlight: settings.accent || "#38bdf8", stroke: false, caps: false, y: 0.84, wordsPerLine: 5, background: true } },
  ];

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      type Group = { mediaId: string; timelineStart: number; clips: { in: number; out: number; speed: number }[] };
      const groups: Group[] = [];
      let cursor = 0;
      for (const v of project.video) {
        const len = Math.max(0.05, (v.out - v.in) / v.speed);
        const m = project.media.find((x) => x.id === v.mediaId);
        if (m && m.kind !== "image" && m.blobKey) {
          const prev = groups[groups.length - 1];
          if (prev && prev.mediaId === v.mediaId && Math.abs(prev.timelineStart + prev.clips.reduce((acc, c) => acc + (c.out - c.in) / c.speed, 0) - cursor) < 0.005) {
            prev.clips.push({ in: v.in, out: v.out, speed: v.speed });
          } else {
            groups.push({ mediaId: v.mediaId, timelineStart: cursor, clips: [{ in: v.in, out: v.out, speed: v.speed }] });
          }
        }
        cursor += len;
      }

      if (!groups.length) {
        const audioTrack = project.music.find((x) => !x.auto) ?? project.music[0];
        const m = audioTrack
          ? project.media.find((x) => x.id === audioTrack.mediaId)
          : project.media.find((x) => x.kind === "video" || x.kind === "audio");
        if (!m || !m.blobKey) throw new Error("No media available to transcribe. Import a video/audio clip first.");
        groups.push({
          mediaId: m.id,
          timelineStart: audioTrack ? audioTrack.start : 0,
          clips: audioTrack ? [{ in: audioTrack.in, out: audioTrack.out, speed: 1 }] : [],
        });
      }

      toast("Generating captions with AI… this can take a moment.", "info");
      const allWords: CaptionWord[] = [];
      const texts: string[] = [];
      for (const g of groups) {
        const m = project.media.find((x) => x.id === g.mediaId);
        if (!m?.blobKey) continue;
        const blob = await getBlob(m.blobKey);
        if (!blob) throw new Error("Media bytes are missing. Re-import the file.");
        const out = await generateCaptionsForBlob(blob, settings, {
          format: "json",
          clips: g.clips.length ? g.clips : undefined,
        });
        if (out.words.length) {
          for (const w of out.words) {
            allWords.push({
              ...w,
              start: Number((w.start + g.timelineStart).toFixed(3)),
              end: Number((w.end + g.timelineStart).toFixed(3)),
            });
          }
        } else if (out.text) {
          texts.push(out.text);
        }
      }

      if (allWords.length) {
        allWords.sort((a, b) => a.start - b.start);
        editProject((p) => ({ ...p, captions: allWords }));
        toast(`Generated ${allWords.length} caption words`, "success");
      } else if (texts.length) {
        const list = texts.join(" ").split(/\s+/).filter(Boolean);
        const span = Math.max(0.5, duration);
        const each = span / Math.max(1, list.length);
        const made = list.map((w, k) => ({ id: uid("w"), text: w, start: k * each, end: (k + 1) * each - 0.02 }));
        if (made.length) {
          editProject((p) => ({ ...p, captions: made }));
          toast(`Generated ${made.length} caption words`, "success");
        } else {
          throw new Error("No words returned. Check nemo-speech/model setup.");
        }
      } else {
        throw new Error("No words returned. Check nemo-speech/model setup.");
      }
    } catch (e) {
      toast((e as Error).message || "Caption generation failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (selection?.kind !== "caption") return;
    listRef.current?.querySelector(`[data-word="${selection.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  const importSubs = async (f: File) => {
    const parsed = parseSubtitles(await f.text());
    if (!parsed.length) return toast("No captions found in that file. Clipweave reads .srt and .vtt.", "error");
    editProject((p) => ({ ...p, captions: parsed }));
    toast(`Imported ${parsed.length} words`, "success");
  };

  const editWord = (id: string, patch: Partial<CaptionWord>, key: string) =>
    editProject((p) => ({ ...p, captions: p.captions.map((w) => (w.id === id ? { ...w, ...patch } : w)) }), key);

  return (
    <div className={`captions-bento-grid${words.length > 0 ? " has-words" : ""}`}>
      <Section
        title="Words"
        className="captions-words-sec"
        aside={
          <div className="row">
            <button className="btn ghost sm" onClick={() => fileRef.current?.click()} title="Import .srt or .vtt captions">
              <FileUp className="ic" /> .srt / .vtt
            </button>
            <input ref={fileRef} type="file" accept=".srt,.vtt,text/vtt" hidden onChange={(e) => e.target.files?.[0] && importSubs(e.target.files[0])} />
            <button className="btn accent sm" onClick={() => void generate()} disabled={busy || duration <= 0} title="Generate captions with AI">
              {busy ? <span className="spinner" /> : <Sparkles className="ic" />} AI captions
            </button>
          </div>
        }
      >
        {words.length > 0 && (
          <>
            <div className="row word-head">
              <span className="muted grow tabular">{words.length} words</span>
              <button className="btn plain sm" onClick={() => editProject((p) => ({ ...p, captions: [] }))}>
                Clear all
              </button>
            </div>
            <div className="word-list" ref={listRef}>
              {words.map((w) => (
                <div
                  key={w.id}
                  data-word={w.id}
                  className={`word-row${selection?.kind === "caption" && selection.id === w.id ? " sel" : ""}`}
                  onFocus={() => onSelect({ kind: "caption", id: w.id })}
                >
                  <input className="input" value={w.text} aria-label="Word" onChange={(e) => editWord(w.id, { text: e.target.value }, `w-${w.id}`)} />
                  <NumberInput label="Start" value={w.start} step={0.05} min={0} suffix="s" onChange={(v) => editWord(w.id, { start: Math.max(0, Math.min(v, w.end - 0.05)) }, `ws-${w.id}`)} />
                  <NumberInput label="End" value={w.end} step={0.05} suffix="s" onChange={(v) => editWord(w.id, { end: Math.max(v, w.start + 0.05) }, `we-${w.id}`)} />
                  <button
                    className="btn plain icon sm"
                    title="Start at the playhead"
                    aria-label="Start at the playhead"
                    onClick={() => {
                      const t = player.clock.time;
                      editWord(w.id, { start: t, end: Math.max(t + 0.1, w.end - w.start + t) }, `wp-${w.id}`);
                    }}
                  >
                    <Crosshair className="ic" />
                  </button>
                  <button className="btn plain icon sm" aria-label="Delete word" onClick={() => editProject((p) => ({ ...p, captions: p.captions.filter((x) => x.id !== w.id) }))}>
                    <Trash2 className="ic" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>
      <Section title="Style & Font" className="captions-style-sec">
        <StackField label="Quick style presets">
          <div className="caption-presets">
            {CAPTION_PRESETS.map((p) => (
              <button key={p.id} type="button" className="caption-preset-btn" onClick={() => set(p.patch, `cp-${p.id}`)} title="Apply caption style preset">
                <i className="caption-preset-swatch" style={{ background: p.patch.highlight }} aria-hidden="true" />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </StackField>
        <StackField label="Font">
          <Seg full label="Caption font" value={s.font} onChange={(font) => set({ font }, "cfont")} options={FONT_OPTIONS} />
        </StackField>
        <Row label="Size">
          <Range label="Caption size" value={s.size} min={20} max={80} step={1} onChange={(v) => set({ size: v }, "csize")} />
          <span className="val tabular">{s.size}</span>
        </Row>
        <Row label="Height">
          <Range label="Caption height" value={s.y} min={0.1} max={0.92} onChange={(v) => set({ y: v }, "cy")} />
          <span className="val tabular">{Math.round(s.y * 100)}%</span>
        </Row>
        <StackField label="Words per line">
          <Seg full label="Words at once" value={s.wordsPerLine} onChange={(v) => set({ wordsPerLine: v }, "wpl")} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
        </StackField>
        <div className="insp-mini-grid">
          <div className="insp-mini-item">
            <span>Colour</span>
            <ColorField label="Caption colour" value={s.color} onChange={(v) => set({ color: v }, "ccol")} />
          </div>
          <div className="insp-mini-item">
            <span>Spoken</span>
            <ColorField label="Highlight colour" value={s.highlight} onChange={(v) => set({ highlight: v }, "chl")} />
          </div>
          <div className="insp-mini-item">
            <span>Outline</span>
            <Switch label="Outline" checked={s.stroke} onChange={(v) => set({ stroke: v }, "cst")} />
          </div>
          <div className="insp-mini-item">
            <span>Capitals</span>
            <Switch label="Capitals" checked={s.caps} onChange={(v) => set({ caps: v }, "ccaps")} />
          </div>
          <div className="insp-mini-item">
            <span>Background</span>
            <Switch label="Background" checked={s.background} onChange={(v) => set({ background: v }, "cbg")} />
          </div>
        </div>
      </Section>
    </div>
  );
}
