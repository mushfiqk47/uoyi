import { useRef, useState } from "react";
import { Film, Image as ImageIcon, Music, Plus, Upload } from "lucide-react";
import type { Project } from "../../lib/types";
import { useStore } from "../../store";
import { importFile } from "../../lib/media";
import { fmtTime, uid } from "../../lib/util";
import type { Player } from "../player";
import { Section } from "./shared";

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
