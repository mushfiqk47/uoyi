import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  ArrowLeft, ArrowRight, Copy, Crosshair, FileUp, Film, Image as ImageIcon, LayoutTemplate, Music, Pencil, Plus, Save, Search,
  Sparkles, Star, Trash2, Type, Upload, Wand2, Check, X,
} from "lucide-react";
import type { CaptionFont, CaptionWord, Layout, Overlay, OverlayPlatform, Project, Rect, TextItem } from "../lib/types";
import { useStore } from "../store";
import { activeClipAt, clipStarts, projectDuration, withoutVideoClip } from "../lib/project";
import { ColorField, Field, Modal, NumberInput, Range, Seg, Switch } from "../components/ui";
import { clamp, fmtTime, uid } from "../lib/util";
import { importFile } from "../lib/media";
import { getBlob } from "../lib/db";
import { generateCaptionsForBlob } from "../lib/ai/captions";
import { applyFacecam, detectFacecam as detectFacecamNow } from "./facecam";
import { parseSubtitles } from "../lib/subtitles";
import type { Player } from "./player";
import type { Selection } from "./Timeline";

const FONT_OPTIONS: { value: CaptionFont; label: string }[] = [
  { value: "bebas", label: "Bebas" },
  { value: "tiktok", label: "TikTok Sans" },
  { value: "inter", label: "Inter" },
];

function Section({ title, children, aside, wide }: { title: string; children: React.ReactNode; aside?: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`insp-sec${wide ? " wide" : ""}`}>
      <div className="insp-sec-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="insp-row">
      <span>{label}</span>
      <div className="insp-ctl">{children}</div>
    </div>
  );
}

function StackField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="insp-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function fmtSignedPct(v: number): string {
  const pct = Math.round(v * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

// ---------------------------------------------------------------- Frame

export function FramePanel({
  project,
  player,
  selectedVideoId,
  onAddText,
}: {
  project: Project;
  player: Player;
  selectedVideoId: string | null;
  onAddText: () => void;
}) {
  const { editProject, toast } = useStore();
  const L = project.layout;
  const set = (patch: Partial<Layout>, key: string) => editProject((p) => ({ ...p, layout: { ...p.layout, ...patch } }), key);
  const faceRef = useRef<string | null>(null);
  const [faceBusy, setFaceBusy] = useState(false);
  const [faceInfo, setFaceInfo] = useState("");
  const targetVideo = (selectedVideoId && project.video.find((v) => v.id === selectedVideoId)) || project.video[0] || null;
  const duration = projectDuration(project);

  const detectFacecam = async () => {
    setFaceBusy(true);
    try {
      const res = await detectFacecamNow(project, player, faceRef);
      setFaceInfo(res.message);
      if (res.ok && res.rect) {
        applyFacecam(set, res.rect);
        toast("Facecam detected and placed", "success");
      } else if (res.notify === "toast") {
        toast(res.message, "error");
      }
    } catch (e) {
      toast((e as Error).message || "Facecam detection failed.", "error");
    } finally {
      setFaceBusy(false);
    }
  };
  return (
    <>
      <Section title="Layout">
        <Seg
          full
          label="Layout"
          value={L.mode}
          onChange={(mode) => set({ mode }, "mode")}
          options={[
            { value: "fill", label: "Fill" },
            { value: "fit", label: "Fit" },
            { value: "split", label: "Facecam + game" },
          ]}
        />
        <p className="insp-help">
          {L.mode === "fill" && "Crops to fill 9:16. Zoom and pan to frame the action."}
          {L.mode === "fit" && "Fits the whole picture over a blurred backdrop."}
          {L.mode === "split" && "Game on top, streamer facecam below. Drag the box below."}
        </p>
      </Section>

      <Section
        title="Facecam AI"
        aside={
          <button className="btn ghost sm" onClick={() => void detectFacecam()} disabled={faceBusy}>
            <Sparkles className="ic" /> {faceBusy ? "Detecting…" : "Detect AI"}
          </button>
        }
      >
        <p className="insp-help">
          {faceInfo || "YuNet + SFace auto-detects and locks onto the streamer's facecam."}
        </p>
        <div className="insp-actions-end">
          <button className="btn plain sm" onClick={() => { faceRef.current = null; setFaceInfo("Face lock reset."); }}>
            Reset lock
          </button>
        </div>
      </Section>

      <Section
        title={L.mode === "split" ? "Clip & Facecam" : "Clip & Quick"}
        aside={
          <button className="btn ghost sm" onClick={onAddText} disabled={duration <= 0} title="Add text overlay at playhead">
            <Plus className="ic" /> Add text
          </button>
        }
      >
        {targetVideo && (
          <StackField label="Clip speed">
            <Seg
              full
              label="Clip speed"
              value={targetVideo.speed}
              onChange={(speed) =>
                editProject(
                  (p) => ({
                    ...p,
                    video: p.video.map((v) => (v.id === targetVideo.id ? { ...v, speed } : v)),
                  }),
                  `sp-${targetVideo.id}`,
                )
              }
              options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: `${v}×` }))}
            />
          </StackField>
        )}
        {L.mode === "split" ? (
          <>
            <FacecamPicker project={project} player={player} rect={L.facecam} onChange={(facecam) => set({ facecam }, "facecam")} />
            <Row label="Cam height">
              <Range label="Facecam height" value={L.facecamShare} min={0.2} max={0.6} onChange={(v) => set({ facecamShare: v }, "share")} />
              <span className="val tabular">{Math.round(L.facecamShare * 100)}%</span>
            </Row>
          </>
        ) : (
          <p className="insp-help">Switch Layout to Facecam + game to position and resize the camera crop.</p>
        )}
      </Section>

      <Section title={L.mode === "split" ? "Game picture" : "Picture"} aside={<button className="btn plain sm" onClick={() => set({ zoom: 1, panX: 0, panY: 0 }, "reset")}>Reset</button>}>
        <Row label="Zoom">
          <Range label="Zoom" value={L.zoom} min={0.3} max={3} onChange={(v) => set({ zoom: v }, "zoom")} />
          <span className="val tabular">{L.zoom.toFixed(2)}×</span>
        </Row>
        <Row label="Left / right">
          <Range label="Pan horizontally" value={L.panX} min={-1} max={1} onChange={(v) => set({ panX: v }, "panX")} />
          <span className="val tabular">{fmtSignedPct(L.panX)}</span>
        </Row>
        <Row label="Up / down">
          <Range label="Pan vertically" value={L.panY} min={-1} max={1} onChange={(v) => set({ panY: v }, "panY")} />
          <span className="val tabular">{fmtSignedPct(L.panY)}</span>
        </Row>
      </Section>
    </>
  );
}

function FacecamPicker({ project, player, rect, onChange }: { project: Project; player: Player; rect: Rect; onChange: (r: Rect) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);

  // Mirror the current source frame, a few times a second. `project` and `player` are read
  // through a ref: including them in the deps restarted this interval on every editor render
  // (including each queue progress tick), which starved the 250 ms timer during drags.
  const latest = useRef({ project, player });
  latest.current = { project, player };
  useEffect(() => {
    const t = setInterval(() => {
      const { project, player } = latest.current;
      const a = activeClipAt(project, player.clock.time) ?? (project.video[0] ? { clip: project.video[0] } : null);
      const v = a ? player.pool.visuals.get(a.clip.mediaId) : undefined;
      const c = canvasRef.current;
      if (!v || !c) return;
      const w = v instanceof HTMLVideoElement ? v.videoWidth : v.naturalWidth;
      const h = v instanceof HTMLVideoElement ? v.videoHeight : v.naturalHeight;
      if (!w || !h) return;
      setAspect(w / h);
      c.width = 480;
      c.height = Math.round((480 * h) / w);
      try {
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      } catch {
        /* not ready */
      }
    }, 250);
    return () => clearInterval(t);
  }, []);

  const start = (mode: "move" | "resize") => (e: RPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current!.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = { ...rect };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / box.width;
      const dy = (ev.clientY - sy) / box.height;
      if (mode === "move") onChange({ ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) });
      else onChange({ ...r0, w: clamp(r0.w + dx, 0.05, 1 - r0.x), h: clamp(r0.h + dy, 0.05, 1 - r0.y) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="facecam-picker" ref={boxRef} style={{ aspectRatio: aspect }}>
      <canvas ref={canvasRef} />
      <div
        className="facecam-box"
        style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
        onPointerDown={start("move")}
        role="slider"
        aria-label="Facecam area"
        aria-valuetext={`${Math.round(rect.x * 100)}% from left, ${Math.round(rect.y * 100)}% from top`}
        tabIndex={0}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.05 : 0.01;
          const k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
          if (!k) return;
          e.preventDefault();
          onChange({ ...rect, x: clamp(rect.x + k[0], 0, 1 - rect.w), y: clamp(rect.y + k[1], 0, 1 - rect.h) });
        }}
      >
        <span className="facecam-tag">
          <Crosshair className="ic" /> Facecam
        </span>
        <i className="facecam-handle" onPointerDown={start("resize")} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Captions

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
  const [draft, setDraft] = useState("");
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
      const a = activeClipAt(project, 0) || (project.video[0] ? { clip: project.video[0] } : null);
      const m = a ? project.media.find((x) => x.id === a.clip.mediaId) : project.media.find((x) => x.kind === "video" || x.kind === "audio");
      if (!m || !m.blobKey) throw new Error("No media available to transcribe. Import a video/audio clip first.");
      const blob = await getBlob(m.blobKey);
      if (!blob) throw new Error("Media bytes are missing. Re-import the file.");
      toast("Generating captions with AI… this can take a moment.", "info");
      const out = await generateCaptionsForBlob(blob, settings, { format: "json" });
      if (out.words.length) {
        // If transcribing a trimmed clip, offset words by clip timeline start best-effort (simple case: single clip starts at 0).
        editProject((p) => ({ ...p, captions: out.words }));
        toast(`Generated ${out.words.length} caption words`, "success");
      } else if (out.text) {
        setDraft(out.text);
        toast("Transcript generated. Press “Spread” to place words on the timeline.", "success");
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

  const spread = () => {
    const list = draft.split(/\s+/).filter(Boolean);
    if (!list.length) return;
    const from = player.clock.time < duration - 1 ? player.clock.time : 0;
    const span = Math.max(0.5, duration - from);
    const each = span / list.length;
    const made = list.map((w, k) => ({ id: uid("w"), text: w, start: from + k * each, end: from + (k + 1) * each - 0.02 }));
    editProject((p) => ({ ...p, captions: [...p.captions.filter((c) => c.end <= from), ...made] }));
    setDraft("");
    toast(`Placed ${made.length} words from ${fmtTime(from)} to the end. Fine-tune them below.`, "success");
  };

  const importSubs = async (f: File) => {
    const parsed = parseSubtitles(await f.text());
    if (!parsed.length) return toast("No captions found in that file. Clipweave reads .srt and .vtt.", "error");
    editProject((p) => ({ ...p, captions: parsed }));
    toast(`Imported ${parsed.length} words`, "success");
  };

  const editWord = (id: string, patch: Partial<CaptionWord>, key: string) =>
    editProject((p) => ({ ...p, captions: p.captions.map((w) => (w.id === id ? { ...w, ...patch } : w)) }), key);

  return (
    <>
      <Section
        title="Words"
        wide={words.length > 0}
        aside={
          <button className="btn accent sm" onClick={() => void generate()} disabled={busy || duration <= 0} title="Generate captions with AI">
            {busy ? <span className="spinner" /> : <Sparkles className="ic" />} AI captions
          </button>
        }
      >
        <p className="insp-help">
          Word-by-word captions: generate with AI, paste a transcript below, or import `.srt`/`.vtt`.
        </p>
        <textarea className="textarea insp-transcript" rows={2} placeholder="Paste or type the transcript" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Transcript" />
        <div className="row">
          <button className="btn ghost sm grow" onClick={spread} disabled={!draft.trim() || duration <= 0}>
            <Wand2 className="ic" /> Spread from {fmtTime(player.clock.time < duration - 1 ? player.clock.time : 0)}
          </button>
          <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>
            <FileUp className="ic" /> .srt / .vtt
          </button>
          <input ref={fileRef} type="file" accept=".srt,.vtt,text/vtt" hidden onChange={(e) => e.target.files?.[0] && importSubs(e.target.files[0])} />
        </div>
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
      <Section title="Style & Font" wide={words.length > 0}>
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
    </>
  );
}

// ---------------------------------------------------------------- Text

export function TextPanel({ project, player, selection, onSelect }: { project: Project; player: Player; selection: Selection; onSelect: (s: Selection) => void }) {
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
      y: 0.2,
      size: 72,
      color: "#ffffff",
      font: "tiktok",
      stroke: false,
      background: true,
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

// ---------------------------------------------------------------- Overlay

export function OverlayPanel({ project }: { project: Project }) {
  const { editProject, settings, updateSettings } = useStore();
  const o = project.overlay;
  const set = (patch: Partial<Overlay>, key: string) => editProject((p) => ({ ...p, overlay: { ...p.overlay, ...patch } }), key);
  return (
    <>
      <Section title="Social overlay">
        <Seg<OverlayPlatform>
          full
          label="Platform"
          value={o.platform}
          onChange={(platform) => set({ platform }, "plat")}
          options={[
            { value: "off", label: "Off" },
            { value: "tiktok", label: "TikTok" },
            { value: "shorts", label: "Shorts" },
            { value: "reels", label: "Reels" },
          ]}
        />
        <p className="insp-help">Draws the app's buttons and post details over the video so it looks native. Preview only — never burned into rendered files.</p>
        <Row label="Phone preview">
          <Seg label="Phone" value={settings.phone} onChange={(phone) => updateSettings({ phone })} options={[{ value: "iphone", label: "iPhone" }, { value: "android", label: "Android" }]} />
        </Row>
      </Section>
      <Section title="Post details">
        {o.platform !== "off" ? (
          <>
            <div className="two">
              <Field label="Name">
                <input className="input" value={o.name} maxLength={40} onChange={(e) => set({ name: e.target.value.replace(/^@/, "") }, "oname")} />
              </Field>
              <Field label="Sound">
                <input className="input" value={o.song} maxLength={80} onChange={(e) => set({ song: e.target.value }, "osong")} />
              </Field>
            </div>
            <Field label="Caption">
              <textarea className="textarea insp-transcript" rows={2} value={o.caption} maxLength={300} onChange={(e) => set({ caption: e.target.value }, "ocap")} />
            </Field>
            <div className="two">
              <Field label="Likes">
                <NumberInput label="Likes" value={o.likes} step={100} min={0} onChange={(v) => set({ likes: Math.round(Math.max(0, v)) }, "olikes")} />
              </Field>
              <Field label="Comments">
                <NumberInput label="Comments" value={o.comments} step={10} min={0} onChange={(v) => set({ comments: Math.round(Math.max(0, v)) }, "ocom")} />
              </Field>
              <Field label={o.platform === "reels" ? "Reposts" : "Shares"}>
                <NumberInput label="Shares" value={o.shares} step={10} min={0} onChange={(v) => set({ shares: Math.round(Math.max(0, v)) }, "osh")} />
              </Field>
              <Field label={o.platform === "reels" ? "Sends" : "Saves"}>
                <NumberInput label="Saves" value={o.saves} step={10} min={0} onChange={(v) => set({ saves: Math.round(Math.max(0, v)) }, "osv")} />
              </Field>
            </div>
            <Row label="Verified badge">
              <Switch label="Verified badge" checked={o.verified} onChange={(v) => set({ verified: v }, "over")} />
            </Row>
          </>
        ) : (
          <p className="insp-help">Choose TikTok, Shorts, or Reels on the left to preview native social UI and customize post details.</p>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Media

export function MediaPanel({ project, player }: { project: Project; player: Player }) {
  const { editProject, toast } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const addToTimeline = (mediaId: string) => {
    const m = project.media.find((x) => x.id === mediaId);
    if (!m) return;
    if (m.kind === "audio") {
      editProject((p) => ({ ...p, music: [...p.music, { id: uid("a"), mediaId: m.id, start: player.clock.time, in: 0, out: m.duration, volume: 0.8 }] }));
    } else {
      editProject((p) => ({
        ...p,
        video: [...p.video, { id: uid("v"), mediaId: m.id, in: 0, out: m.kind === "image" ? 4 : m.duration, speed: 1, volume: 0 }],
        ...(m.kind === "video"
          ? { music: [...p.music, { id: uid("a"), mediaId: m.id, start: player.clock.time, in: 0, out: m.duration, volume: 1 }] }
          : {}),
      }));
    }
  };

  const onFiles = async (files: FileList) => {
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        try {
          const m = await importFile(f);
          editProject((p) => {
            const next = { ...p, media: [...p.media, m] };
            if (m.kind === "audio") next.music = [...p.music, { id: uid("a"), mediaId: m.id, start: player.clock.time, in: 0, out: m.duration, volume: 0.8 }];
            else next.video = [...p.video, { id: uid("v"), mediaId: m.id, in: 0, out: m.kind === "image" ? 4 : m.duration, speed: 1, volume: 1 }];
            return next;
          });
        } catch (e) {
          toast((e as Error).message, "error");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        title="Add media"
        aside={
          <button className="btn accent sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <span className="spinner" /> : <Upload className="ic" />} Import
          </button>
        }
      >
        <input ref={fileRef} type="file" multiple accept="video/*,audio/*,image/*,.mpg,.mpeg,video/mpeg" hidden onChange={(e) => e.target.files && onFiles(e.target.files)} />
        <p className="insp-help">Videos and pictures append to the video track. Music and sound effects start at the playhead.</p>
      </Section>
      <Section title={`Project files (${project.media.length})`}>
        <div className="pick-list">
          {project.media.map((m) => (
            <div key={m.id} className="pick static">
              {m.kind === "video" ? <Film className="ic" /> : m.kind === "audio" ? <Music className="ic" /> : <ImageIcon className="ic" />}
              <span className="grow">{m.name}</span>
              <em className="tabular">{m.kind === "image" ? `${m.width}×${m.height}` : fmtTime(m.duration)}</em>
              <button className="btn plain icon sm" aria-label={`Add ${m.name} to the timeline`} title="Add to the timeline" onClick={() => addToTimeline(m.id)}>
                <Plus className="ic" />
              </button>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Selected clip

export function ClipPanel({ project, selection, onSelect, player }: { project: Project; selection: Selection; onSelect: (s: Selection) => void; player: Player }) {
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

// ---------------------------------------------------------------- Templates

export function TemplatesPanel({ project }: { project: Project }) {
  const { templates, saveTemplate, applyTemplate, updateTemplate, overwriteTemplate, duplicateTemplate, deleteTemplate, settings, updateSettings, toast } = useStore();
  const [q, setQ] = useState("");
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const shown = templates
    .filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);

  return (
    <>
      <Section title="Templates" aside={<button className="btn accent sm" onClick={() => setNaming({ id: null, name: project.name || "New template" })}><Save className="ic" /> Save look</button>}>
        <p className="insp-help">A template saves this project's layout, facecam box, caption look, overlay and texts to reuse on the next clip.</p>
        {templates.length > 3 && (
          <label className="search">
            <Search className="ic" />
            <input className="input" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates" />
          </label>
        )}
      </Section>
      <Section title={`Saved looks (${shown.length})`}>
        {templates.length === 0 ? (
          <div className="tpl-empty">
            <LayoutTemplate className="ic" />
            <span>No templates yet</span>
          </div>
        ) : (
          <div className="tpl-list">
            {shown.map((t) => (
              <div key={t.id} className={`tpl-item${project.templateId === t.id ? " on" : ""}`}>
                <div className="tpl-swatch" data-mode={t.layout.mode} style={{ ["--hl" as string]: t.captionStyle.highlight }}>
                  <i />
                  <b />
                </div>
                <div className="grow tpl-text">
                  <b>{t.name}</b>
                  <small>
                    {t.layout.mode === "split" ? "With facecam" : t.layout.mode === "fit" ? "Fit" : "Fill"}
                    {t.overlay.platform !== "off" && ` · ${t.overlay.platform === "tiktok" ? "TikTok" : t.overlay.platform === "shorts" ? "Shorts" : "Reels"}`}
                    {settings.defaultTemplateId === t.id && " · Default"}
                  </small>
                </div>
                <button className={`btn plain icon sm star${t.favorite ? " on" : ""}`} aria-pressed={t.favorite} aria-label="Favourite" onClick={() => updateTemplate(t.id, { favorite: !t.favorite })}>
                  <Star className="ic" />
                </button>
                <div className="tpl-actions">
                  <button className="btn ghost sm" onClick={() => { applyTemplate(t.id); toast(`Applied “${t.name}”`, "success"); }}>
                    <Check className="ic" /> Apply
                  </button>
                  <button className="btn plain icon sm" title="Overwrite with this project's look" aria-label="Overwrite" onClick={() => { overwriteTemplate(t.id); toast(`Updated “${t.name}”`, "success"); }}>
                    <Save className="ic" />
                  </button>
                  <button className="btn plain icon sm" title="Rename" aria-label="Rename" onClick={() => setNaming({ id: t.id, name: t.name })}>
                    <Pencil className="ic" />
                  </button>
                  <button className="btn plain icon sm" title="Duplicate" aria-label="Duplicate" onClick={() => duplicateTemplate(t.id)}>
                    <Copy className="ic" />
                  </button>
                  <button
                    className="btn plain sm"
                    title="Use for every new clip"
                    onClick={() => updateSettings({ defaultTemplateId: settings.defaultTemplateId === t.id ? null : t.id })}
                  >
                    {settings.defaultTemplateId === t.id ? "Unset default" : "Set default"}
                  </button>
                  <button className="btn plain icon sm" title="Delete" aria-label="Delete" onClick={() => setConfirmDelete(t.id)}>
                    <Trash2 className="ic" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      {naming && (
        <Modal
          title={naming.id ? "Rename template" : "Save as a template"}
          onClose={() => setNaming(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setNaming(null)}>Cancel</button>
              <button
                className="btn accent"
                disabled={!naming.name.trim()}
                onClick={() => {
                  const name = naming.name.trim().slice(0, 60);
                  if (naming.id) updateTemplate(naming.id, { name });
                  else {
                    saveTemplate(name);
                    toast(`Saved “${name}”`, "success");
                  }
                  setNaming(null);
                }}
              >
                Save
              </button>
            </>
          }
        >
          <Field label="Name">
            <input className="input" autoFocus value={naming.name} maxLength={60} onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
          </Field>
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title="Delete this template?"
          description="Projects that used it keep their look."
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Keep it</button>
              <button className="btn danger" onClick={() => { deleteTemplate(confirmDelete); setConfirmDelete(null); }}>Delete</button>
            </>
          }
        />
      )}
    </>
  );
}
