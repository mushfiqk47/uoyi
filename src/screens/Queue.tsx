import { memo, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Download, ListVideo, Pause, Play, RotateCcw, Trash2, X, CheckCircle2, Clock } from "lucide-react";
import { useQueue, useShellStore, useToastStore } from "../store";
import type { QueueJob } from "../lib/types";
import { blobUrl, getBlob } from "../lib/db";
import { downloadBlob, fmtBytes, fmtDuration, fmtTime, fmtWhen, safeFileName } from "../lib/util";
import { Modal } from "../components/ui";

const isActiveStatus = (s: QueueJob["status"]) => s === "queued" || s === "rendering" || s === "paused";

export function Queue() {
  const { go } = useShellStore();
  const { jobs, queuePaused, setQueuePaused, removeJob } = useQueue();
  const { waiting, finished } = useMemo(() => {
    const upNext: QueueJob[] = [];
    const doneOrFailed: QueueJob[] = [];
    for (const j of jobs) {
      if (isActiveStatus(j.status)) upNext.push(j);
      else doneOrFailed.push(j);
    }
    doneOrFailed.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    return { waiting: upNext, finished: doneOrFailed };
  }, [jobs]);

  const hasFailed = useMemo(() => finished.some((j) => j.status !== "done"), [finished]);

  return (
    <main className="page queue">
      <div className="pagehead">
        <div>
          <h1>Queue</h1>
          <p>Renders run up to 2 at once using fast FFmpeg encoding when available, or in-browser fallback.</p>
        </div>
        <div className="row">
          {finished.length > 0 && (
            <button className="btn ghost sm" onClick={() => finished.filter((j) => j.status !== "done").forEach((j) => removeJob(j.id))} disabled={!hasFailed}>
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

const JobCard = memo(function JobCard({ job, first, last }: { job: QueueJob; first?: boolean; last?: boolean }) {
  const { toast } = useToastStore();
  const { cancelJob, retryJob, moveJob, removeJob, markDownloaded, queuePaused } = useQueue();
  const [watch, setWatch] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const ext = job.mime?.includes("mp4") ? "mp4" : "webm";
  const running = job.status === "rendering" || job.status === "paused";

  useEffect(() => {
    let alive = true;
    if (job.status === "done" && job.outputKey) {
      void blobUrl(job.outputKey).then((u) => alive && setVideoUrl(u));
      void blobUrl(`renderthumb:${job.id}`).then((u) => alive && setPoster(u));
    } else {
      setVideoUrl(null);
      setPoster(null);
    }
    return () => { alive = false; };
  }, [job.status, job.outputKey, job.id]);

  const download = async () => {
    if (!job.outputKey || downloading) return;
    setDownloading(true);
    try {
      const b = await getBlob(job.outputKey);
      if (!b) return toast("This render's file is missing.", "error");
      downloadBlob(b, `${safeFileName(job.fileName)}.${ext}`);
      markDownloaded(job.id);
    } finally {
      setDownloading(false);
    }
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
            {job.status === "rendering" && `Rendering${job.fps > 0 ? ` · ${job.fps} fps` : ""} · ${fmtDuration(job.remaining)} left`}
            {job.status === "paused" && `Paused at ${Math.floor(job.progress * 100)}%`}
            {job.status === "done" && `${fmtWhen(job.finishedAt ?? Date.now())} · ${fmtTime(job.duration)} · ${fmtBytes(job.size)} · ${ext.toUpperCase()}${job.autoSaved ? ` · ${job.autoSaved === "folder" ? "Saved to folder" : "Downloaded"}` : ""}`}
            {job.status === "failed" && (job.failure ?? "Failed")}
            {job.status === "cancelled" && "Cancelled"}
          </small>
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
              <button className="btn accent sm" onClick={() => void download()} disabled={downloading}>
                {downloading ? <span className="spinner" /> : <Download className="ic" />} Download
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
        <div className="render-bar" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${job.progress * 100}%` }} />
        </div>
      )}
      {watch && job.outputKey && <RenderPlayer job={job} onClose={() => setWatch(false)} />}
    </article>
  );
});

function RenderPlayer({ job, onClose }: { job: QueueJob; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setUrl(null);
    if (!job.outputKey) {
      setLoading(false);
      return;
    }
    void blobUrl(job.outputKey)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [job.outputKey]);

  return (
    <Modal title={job.title} onClose={onClose} width={420}>
      {loading ? (
        <div className="render-player-state" role="status" aria-label="Loading render">
          <span className="spinner" />
        </div>
      ) : url ? (
        <video className="render-player" src={url} controls autoPlay playsInline />
      ) : (
        <div className="render-player-state">
          <p className="muted">This render's file is no longer available on this device.</p>
        </div>
      )}
    </Modal>
  );
}
