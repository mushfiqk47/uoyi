import { useMemo, useState } from "react";
import { Clapperboard, Disc, Play, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useLibrary, useShellStore, useStore, useToastStore } from "../store";
import type { Clip } from "../lib/types";
import { fmtTime, fmtWhen } from "../lib/util";
import { getBlob } from "../lib/db";
import { ClipThumb } from "../components/ClipThumb";
import { ClipPreviewModal } from "../components/ClipPreviewModal";
import { Modal, Seg } from "../components/ui";
import { ClipFinderFields, RECORDING_CLIP_FINDER, RECORDING_CLIP_LIMITS, clipFinderError, clipFinderOptions, type ClipFinderValues } from "../features/ai-clips/ClipFinderFields";
import { findClipsInMedia } from "../lib/ai/findClips";
import { uploadMediaBlob } from "../platform/api/media";

type Filter = "all" | "removed";

export function Recommend() {
  const { openClip, go, toast } = useStore();
  const { clips, updateClip, deleteClip, deleteClips } = useLibrary();
  const [filter, setFilter] = useState<Filter>("all");
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);
  const [findClip, setFindClip] = useState<Clip | null>(null);
  const [confirmOne, setConfirmOne] = useState<Clip | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Compute all recordings, removed count, and filtered+sorted view cleanly with memoization.
  const { allRecordings, removedCount } = useMemo(() => {
    const list: Clip[] = [];
    let removed = 0;
    for (const c of clips) {
      if (!c.recording) continue;
      list.push(c);
      if (c.removedAt) removed += 1;
    }
    return { allRecordings: list, removedCount: removed };
  }, [clips]);

  const recordings = useMemo(
    () =>
      allRecordings
        .filter((c) => (filter === "removed" ? !!c.removedAt : !c.removedAt))
        .sort((a, b) => b.capturedAt - a.capturedAt),
    [allRecordings, filter],
  );

  return (
    <main className="page recommend">
      <div className="pagehead">
        <div>
          <h1>Record gallery</h1>
          <p>Stream recordings, newest first. Record saves land here; clips found by AI from a recording go to Clips.</p>
        </div>
        <div className="row">
          <Seg<Filter>
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "removed", label: `Removed${removedCount ? ` · ${removedCount}` : ""}` },
            ]}
          />
          {filter === "removed" && removedCount > 0 && (
            <button className="btn danger sm" onClick={() => setConfirmAll(true)}>
              <Trash2 className="ic" /> Delete all
            </button>
          )}
        </div>
      </div>

      {recordings.length === 0 ? (
        <div className="empty card-empty">
          <div className="badge">
            <Disc className="ic" />
          </div>
          {filter === "removed" ? (
            <>
              <h2>Nothing removed</h2>
              <p>Removed recordings wait here until you restore or delete them.</p>
            </>
          ) : (
            <>
              <h2>Nothing recorded yet</h2>
              <p>Add a stream on the Viewer tab, then press Record. Each auto-save appears here as soon as the segment is closed.</p>
              <button className="btn accent" onClick={() => go("viewer")}>
                Go to the Viewer
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="reco-grid">
          {recordings.map((c) => (
            <article key={c.id} className="reco-card" aria-label={c.streamTitle}>
              <button className="reco-thumb" onClick={() => setPreviewClip(c)} aria-label={`Preview the recording of ${c.streamTitle}`}>
                <ClipThumb clip={c} />
                <span className="reco-len tabular">{fmtTime(c.seconds)}</span>
              </button>
              <div className="reco-info">
                <div className="row">
                  <b className="grow reco-title" title={c.streamTitle}>{c.streamTitle}</b>
                  <span className="muted reco-when">{fmtWhen(c.capturedAt)}</span>
                </div>
                <div className="row reco-actions">
                  {c.removedAt ? (
                    <>
                      <button className="btn ghost sm grow" onClick={() => updateClip(c.id, { removedAt: null })}>
                        <RotateCcw className="ic" /> Restore
                      </button>
                      <button className="btn danger icon sm" onClick={() => setConfirmOne(c)} aria-label={`Delete the recording of ${c.streamTitle} for good`} title="Delete for good">
                        <Trash2 className="ic" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn accent icon sm"
                        onClick={() => openClip(c)}
                        aria-label={`Edit the recording of ${c.streamTitle}`}
                        title="Open in editor"
                      >
                        <Clapperboard className="ic" />
                      </button>
                      <button
                        className="btn ghost icon sm"
                        onClick={() => setPreviewClip(c)}
                        aria-label={`Preview the recording of ${c.streamTitle}`}
                        title="Preview"
                      >
                        <Play className="ic" />
                      </button>
                      <button
                        className="btn ghost sm grow"
                        onClick={() => setFindClip(c)}
                        title="Let AI find the best moments in this recording"
                      >
                        <Sparkles className="ic" /> Find clips
                      </button>
                      <button
                        className="btn ghost icon sm"
                        onClick={() => updateClip(c.id, { removedAt: Date.now() })}
                        aria-label={`Remove the recording of ${c.streamTitle}`}
                        title="Remove"
                      >
                        <X className="ic" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {previewClip && <ClipPreviewModal clip={previewClip} onClose={() => setPreviewClip(null)} />}
      {findClip && <FindRecordClipsModal clip={findClip} onClose={() => setFindClip(null)} />}

      {confirmOne && (
        <Modal
          title="Delete this recording for good?"
          description="Its video is erased from this device. This can't be undone."
          onClose={() => { if (!deleting) setConfirmOne(null); }}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmOne(null)} disabled={deleting}>
                Keep it
              </button>
              <button
                className="btn danger"
                disabled={deleting}
                onClick={() => {
                  void (async () => {
                    setDeleting(true);
                    try {
                      await deleteClip(confirmOne.id);
                      setConfirmOne(null);
                    } finally {
                      setDeleting(false);
                    }
                  })();
                }}
              >
                {deleting ? <span className="spinner" /> : null}
                Delete
              </button>
            </>
          }
        />
      )}

      {confirmAll && (
        <Modal
          title={`Delete all ${removedCount} removed recordings?`}
          description="Their videos and thumbnails are erased from this device. This can't be undone."
          onClose={() => { if (!deleting) setConfirmAll(false); }}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmAll(false)} disabled={deleting}>
                Cancel
              </button>
              <button
                className="btn danger"
                disabled={deleting}
                onClick={() => {
                  void (async () => {
                    setDeleting(true);
                    try {
                      const ids = allRecordings.filter((c) => c.removedAt).map((c) => c.id);
                      await deleteClips(ids);
                      toast(`Deleted ${ids.length} recording${ids.length === 1 ? "" : "s"}`, "success");
                      setConfirmAll(false);
                    } finally {
                      setDeleting(false);
                    }
                  })();
                }}
              >
                {deleting ? <span className="spinner" /> : <Trash2 className="ic" />} Delete all
              </button>
            </>
          }
        />
      )}
    </main>
  );
}

/** Runs the AI Clip Finder on a saved recording. Auto mode lets the AI pick the count and
 *  lengths; saved clips go to Clips, never back into the recording gallery. */
function FindRecordClipsModal({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const { settings, go } = useShellStore();
  const { toast } = useToastStore();
  const { addClip, autoCaptionClip } = useLibrary();
  const [finder, setFinder] = useState<ClipFinderValues>(RECORDING_CLIP_FINDER);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const invalid = clipFinderError(finder);
    if (invalid) return toast(invalid, "error");
    const options = clipFinderOptions(finder, settings.aiClipThreshold, RECORDING_CLIP_LIMITS);
    setBusy(true);
    try {
      setStatus("Loading the recording…");
      const blob = await getBlob(clip.blobKey);
      if (!blob) throw new Error("That recording's video is missing.");
      setStatus("Uploading the recording to the local API…");
      const name = `${clip.streamTitle || "recording"}${blob.type.includes("webm") ? ".webm" : ".mp4"}`;
      const j = await uploadMediaBlob(blob, name);
      const saved = await findClipsInMedia({
        media: { id: j.id, title: clip.streamTitle || "Recording" },
        settings,
        options,
        onStatus: setStatus,
        addClip,
        autoCaptionClip: settings.autoCaptionOnClip ? autoCaptionClip : undefined,
      });
      onClose();
      toast(`AI saved ${saved} clip${saved === 1 ? "" : "s"} to Clips`, "success", { label: "Clips", run: () => go("clips") });
    } catch (e) {
      toast((e as Error).message || "Clip finder failed.", "error");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <Modal
      title="Find clips in recording"
      description={`AI transcribes ${clip.streamTitle} locally and saves up to 4 strong moments (score 8+). One is enough if it is the only one that qualifies. The recording stays in Records.`}
      onClose={() => { if (!busy) onClose(); }}
      width={620}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn accent" onClick={() => void run()} disabled={busy}>
            {busy ? <span className="spinner" /> : <Sparkles className="ic" />}
            {busy ? "Finding clips…" : "Find & save clips"}
          </button>
        </>
      }
    >
      <ClipFinderFields value={finder} onChange={setFinder} disabled={busy} limits={RECORDING_CLIP_LIMITS} />
      {status && <p className="clip-finder-status" role="status" aria-live="polite">{status}</p>}
    </Modal>
  );
}
