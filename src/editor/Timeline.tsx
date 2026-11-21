import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import { Captions, Film, Image as ImageIcon, Music, Scissors, Sparkles, Trash2, Type, ZoomIn, ZoomOut } from "lucide-react";
import type { Project } from "../lib/types";
import { activeClipAt, clipLength, clipStarts } from "../lib/project";
import { useStore } from "../store";
import type { Player } from "./player";
import { useClock } from "./player";
import { clamp, fmtTime } from "../lib/util";

export type Selection = { kind: "video" | "text" | "caption" | "music"; id: string } | null;

const HEAD_W = 108;

function useDrag() {
  return (e: RPointerEvent, onMove: (dx: number, ev: PointerEvent) => void, onEnd?: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const move = (ev: PointerEvent) => onMove(ev.clientX - startX, ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

/** Arrow keys nudge a trim/move handle into place; Shift changes it by a single frame. */
function keyNudge(e: RKeyboardEvent, onStep: (dir: number, fine: boolean) => void) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  e.stopPropagation();
  onStep(e.key === "ArrowLeft" ? -1 : 1, e.shiftKey);
}

export function Timeline({
  project,
  player,
  selection,
  onSelect,
  onSplit,
  onDelete,
  onAddText,
  onDetectAi,
  detectingAi = false,
}: {
  project: Project;
  player: Player;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSplit: () => void;
  onDelete?: () => void;
  onAddText?: () => void;
  onDetectAi?: () => void;
  detectingAi?: boolean;
}) {
  const { editProject } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(40);
  const [userZoomed, setUserZoomed] = useState(false);
  const [viewW, setViewW] = useState(0);
  const duration = player.duration;
  const drag = useDrag();
  const targetVideo =
    (selection?.kind === "video" ? project.video.find((v) => v.id === selection.id) : undefined) ??
    activeClipAt(project, player.clock.time)?.clip ??
    project.video[0] ??
    null;

  // Fit the whole project in view until the user zooms.
  useLayoutEffect(() => {
    if (userZoomed) return;
    const w = (scrollRef.current?.clientWidth ?? 800) - HEAD_W - 40;
    setPps(clamp(w / Math.max(duration, 1), 4, 400));
  }, [duration, userZoomed]);

  // Measured by ResizeObserver rather than read during render: a layout read here forced a
  // synchronous reflow on every editor render, including each queue progress tick.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewW(el.clientWidth);
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = Math.max(duration * pps + 80, viewW - HEAD_W);
  const starts = clipStarts(project);
  const mediaById = new Map(project.media.map((m) => [m.id, m]));

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left - HEAD_W + el.scrollLeft) / pps;
  };

  const scrub = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    player.seek(timeAt(e.clientX));
    drag(e, (_dx, ev) => player.seek(timeAt(ev.clientX)));
  };

  const zoom = (f: number) => {
    setUserZoomed(true);
    setPps((p) => clamp(p * f, 4, 400));
  };

  // Ticks every 1/2/5/10/30/60 s depending on zoom.
  const step = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 64) ?? 120;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + step; t += step) ticks.push(t);

  return (
    <div className="timeline">
      <div className="timeline-tools">
        <div className="timeline-tools-group">
          <button className="btn ghost sm" onClick={onSplit} title="Split at the playhead (S)">
            <Scissors className="ic" /> Split
          </button>
          {onDelete && (
            <button className="btn ghost sm" onClick={onDelete} disabled={!selection} title="Delete selected item (Del)">
              <Trash2 className="ic" /> Delete
            </button>
          )}
          {onAddText && (
            <button className="btn ghost sm" onClick={onAddText} disabled={duration <= 0} title="Add text overlay at playhead">
              <Type className="ic" /> + Text
            </button>
          )}
          <span className="timeline-sep" aria-hidden="true" />
          <button className="btn plain icon sm" onClick={() => zoom(1 / 1.5)} aria-label="Zoom out" title="Zoom out">
            <ZoomOut className="ic" />
          </button>
          <button className="btn ghost sm" onClick={() => setUserZoomed(false)} title="Fit the whole timeline">
            Fit
          </button>
          <button className="btn plain icon sm" onClick={() => zoom(1.5)} aria-label="Zoom in" title="Zoom in (+)">
            <ZoomIn className="ic" />
          </button>
        </div>
        <div className="timeline-tools-right">
          {onDetectAi && (
            <button
              className="btn ghost sm"
              onClick={onDetectAi}
              disabled={detectingAi || project.video.length === 0}
              title="Auto-detect streamer facecam with AI"
            >
              <Sparkles className="ic" /> {detectingAi ? "Detecting…" : "Detect AI"}
            </button>
          )}
          {targetVideo && (
            <label className="timeline-speed">
              <span className="timeline-speed-label">Speed</span>
              <select
                className="select timeline-speed-select"
                aria-label="Clip speed"
                value={targetVideo.speed}
                onChange={(e) => {
                  const speed = Number(e.target.value);
                  editProject(
                    (p) => ({
                      ...p,
                      video: p.video.map((v) => (v.id === targetVideo.id ? { ...v, speed } : v)),
                    }),
                    `sp-${targetVideo.id}`,
                  );
                }}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: width + HEAD_W }}>
          <div className="tl-ruler" onPointerDown={scrub} style={{ paddingLeft: HEAD_W }}>
            <div className="tl-head-spacer" />
            {ticks.map((t) => (
              <span key={t} className="tick tabular" style={{ left: HEAD_W + t * pps }}>
                {fmtTime(t)}
              </span>
            ))}
          </div>

          <Lane label="Video" icon={<Film className="ic" />} onPointerDown={scrub} section="video">
            {project.video.map((c, i) => {
              const m = mediaById.get(c.mediaId);
              const left = starts[i] * pps;
              const w = clipLength(c) * pps;
              const sel = selection?.kind === "video" && selection.id === c.id;
              const maxOut = m?.kind === "image" ? 600 : (m?.duration ?? c.out);
              const trim = (edge: "in" | "out") => (e: RPointerEvent) => {
                onSelect({ kind: "video", id: c.id });
                const start = { in: c.in, out: c.out };
                drag(e, (dx) => {
                  const ds = (dx / pps) * c.speed;
                  editProject(
                    (p) => ({
                      ...p,
                      video: p.video.map((v) =>
                        v.id !== c.id
                          ? v
                          : edge === "in"
                            ? { ...v, in: clamp(start.in + ds, 0, v.out - 0.1) }
                            : { ...v, out: clamp(start.out + ds, v.in + 0.1, maxOut) },
                      ),
                    }),
                    `trim-${c.id}`,
                  );
                });
              };
              return (
                <div
                  key={c.id}
                  className={`blk video${sel ? " sel" : ""}`}
                  style={{ left, width: Math.max(4, w) }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: "video", id: c.id });
                  }}
                  title={m?.name}
                >
                  <i
                    className="h l"
                    onPointerDown={trim("in")}
                    tabIndex={0}
                    role="slider"
                    aria-label={`Trim in point of ${m?.name ?? "clip"}`}
                    aria-valuemin={0}
                    aria-valuemax={Number(c.out.toFixed(2))}
                    aria-valuenow={Number(c.in.toFixed(2))}
                    aria-valuetext={`${c.in.toFixed(2)} seconds in`}
                    onKeyDown={(e) => keyNudge(e, (dir, fine) => {
                      const step = (fine ? 1 / 30 : 0.5) * c.speed * dir;
                      editProject((p) => ({ ...p, video: p.video.map((v) => (v.id !== c.id ? v : { ...v, in: clamp(v.in + step, 0, v.out - 0.1) })) }), `trim-in-${c.id}`);
                    })}
                  />
                  {m?.kind === "image" ? <ImageIcon className="ic" /> : <Film className="ic" />}
                  <span>{m?.name ?? "Missing media"}</span>
                  {c.speed !== 1 && <em>{c.speed}×</em>}
                  <i
                    className="h r"
                    onPointerDown={trim("out")}
                    tabIndex={0}
                    role="slider"
                    aria-label={`Trim out point of ${m?.name ?? "clip"}`}
                    aria-valuemin={Number(c.in.toFixed(2))}
                    aria-valuemax={Number(maxOut.toFixed(2))}
                    aria-valuenow={Number(c.out.toFixed(2))}
                    aria-valuetext={`${c.out.toFixed(2)} seconds out`}
                    onKeyDown={(e) => keyNudge(e, (dir, fine) => {
                      const step = (fine ? 1 / 30 : 0.5) * c.speed * dir;
                      editProject((p) => ({ ...p, video: p.video.map((v) => (v.id !== c.id ? v : { ...v, out: clamp(v.out + step, v.in + 0.1, maxOut) })) }), `trim-out-${c.id}`);
                    })}
                  />
                </div>
              );
            })}
          </Lane>

          <Lane label="Text" icon={<Type className="ic" />} onPointerDown={scrub} section="text">
            {project.texts.map((t) => {
              const sel = selection?.kind === "text" && selection.id === t.id;
              const move = (mode: "move" | "start" | "end") => (e: RPointerEvent) => {
                onSelect({ kind: "text", id: t.id });
                const s0 = { start: t.start, end: t.end };
                drag(e, (dx) => {
                  const d = dx / pps;
                  editProject(
                    (p) => ({
                      ...p,
                      texts: p.texts.map((x) => {
                        if (x.id !== t.id) return x;
                        if (mode === "move") {
                          const len = s0.end - s0.start;
                          const start = clamp(s0.start + d, 0, Math.max(0, duration - len));
                          return { ...x, start, end: start + len };
                        }
                        if (mode === "start") return { ...x, start: clamp(s0.start + d, 0, x.end - 0.2) };
                        return { ...x, end: clamp(s0.end + d, x.start + 0.2, Math.max(duration, x.start + 0.2)) };
                      }),
                    }),
                    `text-${t.id}`,
                  );
                });
              };
              const keyText = (mode: "move" | "start" | "end") => (dir: number, fine: boolean) => {
                const step = (fine ? 1 / 30 : 0.5) * dir;
                editProject((p) => ({
                  ...p,
                  texts: p.texts.map((x) => {
                    if (x.id !== t.id) return x;
                    if (mode === "move") {
                      const len = x.end - x.start;
                      const start = clamp(x.start + step, 0, Math.max(0, duration - len));
                      return { ...x, start, end: start + len };
                    }
                    if (mode === "start") return { ...x, start: clamp(x.start + step, 0, x.end - 0.2) };
                    return { ...x, end: clamp(x.end + step, x.start + 0.2, Math.max(duration, x.start + 0.2)) };
                  }),
                }), `text-key-${t.id}`);
              };
              return (
                <div
                  key={t.id}
                  className={`blk text${sel ? " sel" : ""}`}
                  style={{ left: t.start * pps, width: Math.max(6, (t.end - t.start) * pps) }}
                  onPointerDown={move("move")}
                  tabIndex={0}
                  role="group"
                  aria-label={`Text clip ${t.text || "item"}. Arrow keys move it, its handles trim it.`}
                  onKeyDown={(e) => keyNudge(e, keyText("move"))}
                >
                  <i className="h l" onPointerDown={move("start")} tabIndex={0} role="slider" aria-label={`Text start of ${t.text || "item"}`} aria-valuemin={0} aria-valuemax={Number(t.end.toFixed(2))} aria-valuenow={Number(t.start.toFixed(2))} aria-valuetext={`${t.start.toFixed(2)} seconds`} onKeyDown={(e) => keyNudge(e, keyText("start"))} />
                  <span>{t.text || "Text"}</span>
                  <i className="h r" onPointerDown={move("end")} tabIndex={0} role="slider" aria-label={`Text end of ${t.text || "item"}`} aria-valuemin={Number(t.start.toFixed(2))} aria-valuemax={Number(duration.toFixed(2))} aria-valuenow={Number(t.end.toFixed(2))} aria-valuetext={`${t.end.toFixed(2)} seconds`} onKeyDown={(e) => keyNudge(e, keyText("end"))} />
                </div>
              );
            })}
          </Lane>

          <Lane label="Captions" icon={<Captions className="ic" />} onPointerDown={scrub} section="caption">
            {project.captions.map((w) => {
              const sel = selection?.kind === "caption" && selection.id === w.id;
              return (
                <div
                  key={w.id}
                  className={`blk caption${sel ? " sel" : ""}`}
                  style={{ left: w.start * pps, width: Math.max(3, (w.end - w.start) * pps - 1) }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: "caption", id: w.id });
                    player.seek(w.start);
                  }}
                  title={w.text}
                >
                  {(w.end - w.start) * pps > 24 && <span>{w.text}</span>}
                </div>
              );
            })}
          </Lane>

          <Lane label="Audio" icon={<Music className="ic" />} onPointerDown={scrub} section="audio">
            {project.music.map((c) => {
              const m = mediaById.get(c.mediaId);
              const sel = selection?.kind === "music" && selection.id === c.id;
              return (
                <div
                  key={c.id}
                  className={`blk audio${sel ? " sel" : ""}`}
                  style={{ left: c.start * pps, width: Math.max(6, (c.out - c.in) * pps) }}
                  onPointerDown={(e) => {
                    onSelect({ kind: "music", id: c.id });
                    const s0 = c.start;
                    drag(e, (dx) =>
                      editProject((p) => ({ ...p, music: p.music.map((x) => (x.id === c.id ? { ...x, start: Math.max(0, s0 + dx / pps) } : x)) }), `music-${c.id}`),
                    );
                  }}
                  tabIndex={0}
                  role="slider"
                  aria-label={`Move audio ${m?.name ?? "item"}`}
                  aria-valuemin={0}
                  aria-valuemax={Number(duration.toFixed(2))}
                  aria-valuenow={Number(c.start.toFixed(2))}
                  aria-valuetext={`${c.start.toFixed(2)} seconds in`}
                  onKeyDown={(e) => keyNudge(e, (dir, fine) => {
                    const step = (fine ? 1 / 30 : 0.5) * dir;
                    editProject((p) => ({ ...p, music: p.music.map((x) => (x.id === c.id ? { ...x, start: Math.max(0, x.start + step) } : x)) }), `music-key-${c.id}`);
                  })}
                  title={m?.name}
                >
                  <Music className="ic" />
                  <span>{m?.name ?? "Missing media"}</span>
                </div>
              );
            })}
          </Lane>

          <Playhead player={player} pps={pps} scrollRef={scrollRef} onDrag={scrub} />
        </div>
      </div>
    </div>
  );
}

function Lane({
  label,
  icon,
  section,
  children,
  onPointerDown,
}: {
  label: string;
  icon: React.ReactNode;
  section: string;
  children: React.ReactNode;
  onPointerDown: (e: RPointerEvent) => void;
}) {
  return (
    <div className="lane" data-section={section}>
      <div className="track-header">
        {icon}
        {label}
      </div>
      <div className="lane-body" onPointerDown={onPointerDown}>
        {children}
      </div>
    </div>
  );
}

function Playhead({
  player,
  pps,
  scrollRef,
  onDrag,
}: {
  player: Player;
  pps: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onDrag: (e: RPointerEvent) => void;
}) {
  const { time, playing } = useClock(player.clock);
  const x = HEAD_W + time * pps;
  const raf = useRef(0);

  // Keep the playhead in view while playing. The clock emits once per frame, so the scroll
  // correction is coalesced into one rAF instead of reading and writing layout on every emit.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing || raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const scroller = scrollRef.current;
      if (!scroller) return;
      if (x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = x - HEAD_W - 40;
      else if (x < scroller.scrollLeft + HEAD_W) scroller.scrollLeft = Math.max(0, x - HEAD_W - 40);
    });
  }, [x, playing, scrollRef]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  return (
    <div className="playhead" style={{ transform: `translateX(${x}px)` }}>
      <span className="playhead-grip" onPointerDown={onDrag} />
    </div>
  );
}
