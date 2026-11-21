import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
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
  return (
    <div className="preview">
      <div className="preview-stage">
        <div className={`phone ${frame === "phone" ? phone : "plain"}`}>
          <canvas ref={player.canvasRef} width={PREVIEW_W} height={PREVIEW_H} onClick={() => player.toggle()} aria-label="Preview" />
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
  );
}
