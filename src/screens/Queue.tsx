import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Copy, Download, FolderOpen, ListVideo, Pause, Play, RotateCcw, Trash2, X, CheckCircle2, Clock } from "lucide-react";
import { useQueue, useStore } from "../store";
import type { QueueJob } from "../lib/types";
import { acquireBlobUrl, getBlob } from "../lib/db";
import { downloadBlob, fmtBytes, fmtDuration, fmtTime, fmtWhen, safeFileName } from "../lib/util";
import { revealFileInFolder } from "../platform/desktop";
import { Modal } from "../components/ui";

export function Queue() {
  const { go } = useStore();
  const { jobs, queuePaused, setQueuePaused, removeJob } = useQueue();
  const active = (s: QueueJob["status"]) => s === "queued" || s === "rendering" || s === "paused";
  const waiting = jobs.filter((j) => active(j.status));
  const finished = jobs.filter((j) => !active(j.status)).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  return (
    <main className="page queue">
      <div className="pagehead">
        <div>
          <h1>Queue</h1>
          <p>Renders run one at a time using fast FFmpeg encoding when available, or in-browser fallback.</p>
        </div>
        <div className="row">
          {finished.length > 0 && (
            <button className="btn ghost sm" onClick={() => finished.filter((j) => j.status !== "done").forEach((j) => removeJob(j.id))} disabled={!finished.some((j) => j.status !== "done")}>
              Clear failed
            </button>
          )}
          <button className="btn ghost" onClick={() => setQueuePaused(!queuePaused)} disabled={!waiting.length && !queuePaused}>
            {queuePaused ? <Play className="ic" /> : <Pause className="ic" />}
            {queuePaused ? "Resume queue" : "Pause queue"}
          </button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="empty card-empty">
          <div className="badge">
            <ListVideo className="ic" />
          </div>
          <h2>Nothing to render</h2>
          <p>Finish a clip in the Editor and press Render. It lands here, and the finished video is ready to download.</p>
          <button className="btn accent" onClick={() => go("editor")}>
            Open the Editor
          </button>
        </div>
      ) : (
        <div className="queue-cols">
          <section>
            <h2 className="sec-title">
              Up next <span className="muted">{waiting.length}</span>
            </h2>
            {waiting.length === 0 ? (
              <p className="muted queue-none">All caught up.</p>
            ) : (
              <div className="job-list">
                {waiting.map((j, i) => (
                  <JobCard key={j.id} job={j} first={i === 0} last={i === waiting.length - 1} />
                ))}
              </div>
            )}
          </section>
          {finished.length > 0 && (
            <section>
              <h2 className="sec-title">
                Finished <span className="muted">{finished.length}</span>
              </h2>
              <div className="job-list">
                {finished.map((j) => (
                  <JobCard key={j.id} job={j} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function JobCard({ job, first, last }: { job: QueueJob; first?: boolean; last?: boolean }) {
  const { toast } = useStore();
  const { cancelJob, retryJob, moveJob, removeJob, markDownloaded, queuePaused } = useQueue();
  const [watch, setWatch] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const ext = job.mime?.includes("mp4") ? "mp4" : "webm";
  const running = job.status === "rendering" || job.status === "paused";

  useEffect(() => {
    let alive = true;
    const releases: Array<() => void> = [];
    if (job.status === "done" && job.outputKey) {
      void acquireBlobUrl(job.outputKey).then((entry) => {
        if (!entry) return;
        if (!alive) entry.release();
        else {
          releases.push(entry.release);
          setVideoUrl(entry.url);
        }
      });
      void acquireBlobUrl(`renderthumb:${job.id}`).then((entry) => {
        if (!entry) return;
        if (!alive) entry.release();
        else {
          releases.push(entry.release);
          setPoster(entry.url);
        }
      });
    } else {
      setVideoUrl(null);
      setPoster(null);
    }
    return () => {
      alive = false;
      for (const fn of releases) fn();
    };
  }, [job.status, job.outputKey, job.id]);

  const download = async () => {
    if (!job.outputKey) return;
    const b = await getBlob(job.outputKey);
    if (!b) return toast("This render's file is missing.", "error");
    downloadBlob(b, `${safeFileName(job.fileName)}.${ext}`);
    markDownloaded(job.id);
  };

  return (
    <article className={`render-card card s-${job.status}`}>
      <div className="render-main">
        {job.status === "done" && videoUrl ? (
          <button className="render-video-card" onClick={() => setWatch(true)} title="Play this render" aria-label={`Play ${job.title}`}>
            <video
              src={videoUrl}
              poster={poster || undefined}
              muted
              loop
              playsInline
              preload="metadata"
              onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
              onMouseLeave={(e) => { e.currentTarget.pause(); }}
            />
            <span className="render-play"><Play className="ic" /></span>
            {job.autoSaved && (
              <span className="render-saved-tag" title={job.autoSaved === "folder" ? "Saved to your chosen folder" : "Downloaded to this device"}>
                {job.autoSaved === "folder" ? "Saved" : "Downloaded"}
              </span>
            )}
          </button>
        ) : (
          <div className="render-icon">
            {job.status === "done" ? (
              <CheckCircle2 className="ic" />
            ) : job.status === "failed" || job.status === "cancelled" ? (
              <CircleAlert className="ic" />
            ) : running ? (
              <span className="pct tabular">{Math.floor(job.progress * 100)}</span>
            ) : (
              <Clock className="ic" />
            )}
          </div>
        )}
        <div className="grow render-text">
          <b>{job.title}</b>
          <small className="muted">
            {job.status === "queued" && (queuePaused ? "Paused · waiting" : `Waiting · ${fmtTime(job.duration)} long`)}
            {job.status === "rendering" &&
              (queuePaused
                ? `Rendering · ${job.fps} fps · queue paused after this`
                : `Rendering · ${job.fps} fps · ${fmtDuration(job.remaining)} left`)}
            {job.status === "paused" && `Paused at ${Math.floor(job.progress * 100)}%`}
            {job.status === "done" && `${fmtWhen(job.finishedAt ?? Date.now())} · ${fmtTime(job.duration)} · ${fmtBytes(job.size)} · ${ext.toUpperCase()}${job.exportFileName ? ` · Exports/${job.exportFileName}` : job.autoSaved ? ` · ${job.autoSaved === "folder" ? "Saved to folder" : "Downloaded"}` : ""}`}
            {job.status === "failed" && (job.failure ?? "Failed")}
            {job.status === "cancelled" && "Cancelled"}
          </small>
          {job.status === "done" && job.exportPath && (
            <div className="export-path-badge">
              <code title={job.exportPath}>{job.exportPath}</code>
              <button
                type="button"
                className="btn plain icon sm"
                title="Copy export path"
                aria-label="Copy export path"
                onClick={() => {
                  void navigator.clipboard?.writeText(job.exportPath!).then(() => toast("Export path copied", "success")).catch(() => {});
                }}
              >
                <Copy className="ic" />
              </button>
              <button
                type="button"
                className="btn plain icon sm"
                title="Reveal in folder"
                aria-label="Reveal in folder"
                onClick={() => {
                  void revealFileInFolder(job.exportPath!).then((ok) => {
                    if (!ok) toast(`Saved in workspace: ${job.exportPath}`, "info");
                  });
                }}
              >
                <FolderOpen className="ic" />
              </button>
            </div>
          )}
        </div>
        <div className="row render-actions">
          {job.status === "queued" && (
            <>
              <button className="btn plain icon sm" aria-label="Move up" disabled={first} onClick={() => moveJob(job.id, -1)}>
                <ArrowUp className="ic" />
              </button>
              <button className="btn plain icon sm" aria-label="Move down" disabled={last} onClick={() => moveJob(job.id, 1)}>
                <ArrowDown className="ic" />
              </button>
            </>
          )}
          {(job.status === "queued" || running) && (
            <button className="btn ghost sm" onClick={() => cancelJob(job.id)}>
              <X className="ic" /> Cancel
            </button>
          )}
          {(job.status === "failed" || job.status === "cancelled") && (
            <button className="btn ghost sm" onClick={() => retryJob(job.id)}>
              <RotateCcw className="ic" /> Retry
            </button>
          )}
          {job.status === "done" && (
            <>
              <button className="btn ghost sm" onClick={() => setWatch(true)}>
                <Play className="ic" /> Watch
              </button>
              <button className="btn accent sm" onClick={download}>
                <Download className="ic" /> Download
              </button>
            </>
          )}
          {!running && job.status !== "queued" && (
            <button className="btn plain icon sm" aria-label="Remove from the list" title="Remove" onClick={() => removeJob(job.id)}>
              <Trash2 className="ic" />
            </button>
          )}
        </div>
      </div>
      {running && (
        <div className="render-bar">
          <progress value={Math.round(job.progress * 100)} max={100} aria-label={`Render progress for ${job.title}`} />
        </div>
      )}
      {watch && job.outputKey && <RenderPlayer job={job} onClose={() => setWatch(false)} />}
    </article>
  );
}

function RenderPlayer({ job, onClose }: { job: QueueJob; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let release = () => {};
    if (job.outputKey) {
      void acquireBlobUrl(job.outputKey).then((entry) => {
        if (!entry) return;
        if (!alive) entry.release();
        else {
          release = entry.release;
          setUrl(entry.url);
        }
      });
    }
    return () => {
      alive = false;
      release();
    };
  }, [job.outputKey]);
  return (
    <Modal title={job.title} onClose={onClose} width={420}>
      {url ? <video className="render-player" src={url} controls autoPlay playsInline /> : <span className="spinner" />}
    </Modal>
  );
}
