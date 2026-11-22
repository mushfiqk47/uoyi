import { useState } from "react";
import { ArrowRight, Check, Clapperboard, Copy, MonitorPlay, Scissors } from "lucide-react";
import { Modal } from "./ui";
import { useStore } from "../store";

const steps = (seconds: number) => [
  {
    Icon: MonitorPlay,
    title: "Watch",
    body: `Add up to four streams side by side. Clipweave keeps the last ${seconds} seconds of each one in memory while you watch.`,
  },
  {
    Icon: Scissors,
    title: "Clip",
    body: "When something happens, press Clip on a stream, or Clip all. You get the moment that just happened, not what comes next.",
  },
  {
    Icon: Clapperboard,
    title: "Edit",
    body: "Frame it for 9:16, put the game on top with the facecam below, add captions, text and a TikTok, Shorts or Reels overlay, then render it in the Queue.",
  },
];

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { updateSettings, go, settings } = useStore();
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText("pip install streamlink");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  const STEPS = steps(settings.captureSeconds);
  const step = STEPS[i];
  const finish = () => {
    updateSettings({ setupDone: true });
    go("viewer");
    onClose();
  };
  return (
    <Modal
      title="Turn streams into shorts"
      description="Everything runs in this browser tab. Clips and renders stay on this device."
      onClose={finish}
      width={520}
      footer={
        <>
          <div className="steps-dots" aria-hidden>
            {STEPS.map((_, k) => (
              <i key={k} className={k === i ? "on" : ""} />
            ))}
          </div>
          {i > 0 && (
            <button className="btn ghost" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          {i < STEPS.length - 1 ? (
            <button className="btn accent" onClick={() => setI(i + 1)}>
              Next <ArrowRight className="ic" />
            </button>
          ) : (
            <button className="btn accent" onClick={finish}>
              Start watching <ArrowRight className="ic" />
            </button>
          )}
        </>
      }
    >
      <ol className="onboard">
        {STEPS.map((s, k) => (
          <li key={s.title} className={k === i ? "on" : k < i ? "done" : ""}>
            <button onClick={() => setI(k)}>
              <s.Icon className="ic" />
              <span>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="onboard-body" key={i}>
        <step.Icon className="ic" />
        <div>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </div>
      </div>
      <div className="onboard-note">
        <span>
          Tip: Record saves full-quality video straight on the server. Install it once with <code>pip install streamlink</code>
        </span>
        <button className="btn plain icon sm" aria-label="Copy install command" title="Copy command" onClick={() => void copyInstall()}>
          {copied ? <Check className="ic" /> : <Copy className="ic" />}
        </button>
      </div>
    </Modal>
  );
}
