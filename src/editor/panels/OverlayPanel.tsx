import type { Overlay, OverlayPlatform, Project } from "../../lib/types";
import { useStore } from "../../store";
import { Field, NumberInput, Seg, Switch } from "../../components/ui";
import { Row, Section } from "./shared";

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
