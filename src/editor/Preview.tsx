import { useState } from "react";
import { Frame, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Player } from "./player";
import { PREVIEW_H, PREVIEW_W, useClock } from "./player";
import { fmtTime } from "../lib/util";
import type { PhoneStyle } from "../lib/types";
import { Seg } from "../components/ui";

export function Preview({
  player,
  phone,
  frame,
  onFrame,
}: {
  player: Player;
  phone: PhoneStyle;
  frame: "phone" | "plain";
  onFrame: (f: "phone" | "plain") => void;
}) {
  const { time, playing } = useClock(player.clock);
  const [safeZones, setSafeZones] = useState(false);

  return (
    <div className="preview">
      <div className="preview-stage">
        <div className={`phone ${frame === "phone" ? phone : "plain"}`}>
          <canvas ref={player.canvasRef} width={PREVIEW_W} height={PREVIEW_H} onClick={() => player.toggle()} aria-label="Preview" />
          {safeZones && (
            <div className="safe-zone-overlay" aria-hidden="true">
              <div className="safe-zone-top">Top UI clearance</div>
              <div className="safe-zone-rail">Likes / Share</div>
              <div className="safe-zone-bottom">Caption &amp; handle clearance</div>
            </div>
          )}
          {frame === "phone" && <span className="phone-notch" aria-hidden />}
        </div>
      </div>
      <div className="transport">
        <span className="timecode tabular">
          {fmtTime(time, true)} <em>/ {fmtTime(player.duration, true)}</em>
        </span>
        <div className="row">
          <button className="btn plain icon sm" onClick={() => player.seek(0)} aria-label="Go to start">
            <SkipBack className="ic" />
          </button>
          <button className="btn accent icon play" onClick={() => player.toggle()} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="ic" /> : <Play className="ic" />}
          </button>
          <button className="btn plain icon sm" onClick={() => player.seek(player.duration)} aria-label="Go to end">
            <SkipForward className="ic" />
          </button>
        </div>
        <div className="row transport-right">
          <button
            className={`btn icon sm ${safeZones ? "accent" : "ghost"}`}
            onClick={() => setSafeZones((s) => !s)}
            aria-pressed={safeZones}
            aria-label="Toggle social safe zones guide"
            title="Show/hide TikTok, Shorts, and Reels UI safe-zone guides"
          >
            <Frame className="ic" />
          </button>
          <Seg
            label="Preview frame"
            value={frame}
            onChange={onFrame}
            options={[
              { value: "phone", label: "Phone" },
              { value: "plain", label: "Plain" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
