import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Crosshair } from "lucide-react";
import type { Layout, Project, Rect } from "../../lib/types";
import { useStore } from "../../store";
import { activeClipAt } from "../../lib/project";
import { Range, Seg } from "../../components/ui";
import { clamp } from "../../lib/util";
import type { Player } from "../player";
import { fmtSignedPct, Row, Section } from "./shared";

export function FramePanel({
  project,
  player,
}: {
  project: Project;
  player: Player;
}) {
  const { editProject } = useStore();
  const L = project.layout;
  const set = (patch: Partial<Layout>, key: string) => editProject((p) => ({ ...p, layout: { ...p.layout, ...patch } }), key);

  const alignmentSection = (
    <Section
      title="Alignment settings"
      aside={
        <button className="btn plain sm" onClick={() => set({ zoom: 1, panX: 0, panY: 0 }, "reset")}>
          Reset
        </button>
      }
    >
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
      {L.mode === "split" && (
        <Row label="Cam height">
          <Range label="Facecam height" value={L.facecamShare} min={0.2} max={0.6} onChange={(v) => set({ facecamShare: v }, "share")} />
          <span className="val tabular">{Math.round(L.facecamShare * 100)}%</span>
        </Row>
      )}
    </Section>
  );

  const layoutSection = (
    <Section
      title="Layout"
      aside={
        <div className="layout-seg-wrap">
          <Seg
            label="Layout"
            value={L.mode}
            onChange={(mode) => set({ mode }, "mode")}
            options={[
              { value: "fill", label: "Fill" },
              { value: "fit", label: "Fit" },
              { value: "split", label: "Facecam + game" },
            ]}
          />
        </div>
      }
    />
  );

  return L.mode === "split" ? (
    <div className="frame-split-grid">
      <Section title="Facecam crop">
        <FacecamPicker project={project} player={player} rect={L.facecam} onChange={(facecam) => set({ facecam }, "facecam")} />
      </Section>
      <div className="frame-split-col">
        {alignmentSection}
        {layoutSection}
      </div>
    </div>
  ) : (
    <>
      {alignmentSection}
      {layoutSection}
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
  const drawnRef = useRef<{ mediaId: string; time: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const draw = () => {
      const { project, player } = latest.current;
      const a = activeClipAt(project, player.clock.time) ?? (project.video[0] ? { clip: project.video[0] } : null);
      const v = a ? player.pool.visuals.get(a.clip.mediaId) : undefined;
      const c = canvasRef.current;
      if (!a || !v || !c) return;
      const w = v instanceof HTMLVideoElement ? v.videoWidth : v.naturalWidth;
      const h = v instanceof HTMLVideoElement ? v.videoHeight : v.naturalHeight;
      if (!w || !h) return;
      if (v instanceof HTMLVideoElement && (v.readyState < 2 || v.seeking)) return;
      const mediaTime = v instanceof HTMLVideoElement ? v.currentTime : 0;
      const targetH = Math.round((480 * h) / w);
      const prev = drawnRef.current;
      if (prev && prev.mediaId === a.clip.mediaId && prev.w === w && prev.h === h && Math.abs(prev.time - mediaTime) < 0.02) {
        return;
      }
      setAspect(w / h);
      if (c.width !== 480 || c.height !== targetH) {
        c.width = 480;
        c.height = targetH;
      }
      const ctx = c.getContext("2d", { alpha: false });
      if (!ctx) return;
      try {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(v, 0, 0, c.width, c.height);
        drawnRef.current = { mediaId: a.clip.mediaId, time: mediaTime, w, h };
      } catch {
        /* not ready */
      }
    };
    draw();
    const t = setInterval(draw, 250);
    return () => clearInterval(t);
  }, []);

  const start = (mode: "move" | "nw" | "ne" | "sw" | "se") => (e: RPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current!.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = { ...rect };
    const minSize = 0.05;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / box.width;
      const dy = (ev.clientY - sy) / box.height;
      if (mode === "move") {
        onChange({ ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) });
        return;
      }
      const right = r0.x + r0.w;
      const bottom = r0.y + r0.h;
      if (mode === "nw") {
        const x = clamp(r0.x + dx, 0, right - minSize);
        const y = clamp(r0.y + dy, 0, bottom - minSize);
        onChange({ x, y, w: right - x, h: bottom - y });
      } else if (mode === "ne") {
        const y = clamp(r0.y + dy, 0, bottom - minSize);
        const w = clamp(r0.w + dx, minSize, 1 - r0.x);
        onChange({ x: r0.x, y, w, h: bottom - y });
      } else if (mode === "sw") {
        const x = clamp(r0.x + dx, 0, right - minSize);
        const h = clamp(r0.h + dy, minSize, 1 - r0.y);
        onChange({ x, y: r0.y, w: right - x, h });
      } else {
        onChange({ ...r0, w: clamp(r0.w + dx, minSize, 1 - r0.x), h: clamp(r0.h + dy, minSize, 1 - r0.y) });
      }
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
        <i className="facecam-handle nw" onPointerDown={start("nw")} />
        <i className="facecam-handle ne" onPointerDown={start("ne")} />
        <i className="facecam-handle sw" onPointerDown={start("sw")} />
        <i className="facecam-handle se" onPointerDown={start("se")} />
      </div>
    </div>
  );
}
