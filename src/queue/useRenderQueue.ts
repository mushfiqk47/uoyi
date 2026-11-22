import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Clip, JobStatus, Project, QueueJob } from "../lib/types";
import { deleteBlob, getBlob, putBlob } from "../lib/db";
import { projectDuration } from "../lib/project";
import { RenderCancelled, startRender, type RenderHandle } from "../lib/render";
import type { Settings } from "../lib/settings";
import { downloadBlob, safeFileName, uid } from "../lib/util";
import { makeVideoThumb } from "../lib/videoThumb";
import { saveRenderToFolder } from "../lib/renderFolder";
import { MIGRATIONS } from "../platform/storage/keys";

type Toast = (
  text: string,
  tone?: "info" | "error" | "success",
  action?: { label: string; run: () => void },
) => void;

interface RenderQueueOptions {
  projectRef: { current: Project | null };
  settings: Settings;
  updateClip(id: string, patch: Partial<Clip>): void;
  toast: Toast;
  showQueue(): void;
}

const QUEUE_KEY = "queue:v1";
/** One render at a time. Concurrent browser captures fight for the canvas encoder and
 *  cause stutter/frozen frames, and two server FFmpeg jobs thrash CPU/NVENC as well. */
const MAX_CONCURRENT_RENDERS = 1;

/** Queue jobs embed a whole Project, so keep them in IndexedDB rather than localStorage. */
function useQueueStorage(): [QueueJob[], Dispatch<SetStateAction<QueueJob[]>>] {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let saved: QueueJob[] = [];
      try {
        const blob = await getBlob(QUEUE_KEY);
        if (blob) saved = JSON.parse(await blob.text());
      } catch { /* corrupt or unavailable — start fresh */ }
      if (!saved.length) {
        try {
          const old = localStorage.getItem(MIGRATIONS.legacyQueue);
          if (old) saved = JSON.parse(old);
          localStorage.removeItem(MIGRATIONS.legacyQueue);
        } catch { /* ignore */ }
      }
      saved = saved.map((job) =>
        job.status === "rendering" || job.status === "paused"
          ? { ...job, status: "failed" as const, failure: "Interrupted when the page closed" }
          : job,
      );
      if (!alive) return;
      loaded.current = true;
      setJobs(saved);
    })();
    return () => { alive = false; };
  }, []);

  // Progress updates at ~4 Hz; only durable state changes need an immediate write. Status
  // transitions flush at once, progress is coalesced, and pagehide covers the rest.
  const latest = useRef<QueueJob[]>([]);
  latest.current = jobs;
  const lastStatus = useRef("");
  useEffect(() => {
    if (!loaded.current) return;
    const flush = () => {
      void putBlob(QUEUE_KEY, new Blob([JSON.stringify(latest.current)], { type: "application/json" })).catch(() => {});
    };
    const status = jobs.map((job) => job.status).join(",");
    if (status !== lastStatus.current) {
      lastStatus.current = status;
      flush();
      return;
    }
    const t = window.setTimeout(flush, 2000);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pagehide", flush);
    };
  }, [jobs]);

  return [jobs, setJobs];
}

export function useRenderQueue({ projectRef, settings, updateClip, toast, showQueue }: RenderQueueOptions) {
  const [jobs, setJobs] = useQueueStorage();
  const [queuePaused, setQueuePaused] = useState(false);
  const handles = useRef(new Map<string, RenderHandle>());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const patchJob = useCallback(
    (id: string, patch: Partial<QueueJob>) => setJobs((list) => list.map((job) => (job.id === id ? { ...job, ...patch } : job))),
    [setJobs],
  );

  const enqueue = useCallback(
    (title: string, fileName: string) => {
      const project = projectRef.current;
      if (!project) return;
      const duration = projectDuration(project);
      const job: QueueJob = {
        id: uid("job"),
        title,
        fileName,
        project: structuredClone(project),
        duration,
        status: "queued",
        progress: 0,
        fps: 0,
        remaining: duration,
        queuedAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        outputKey: null,
        mime: null,
        size: 0,
        failure: null,
      };
      setJobs((list) => [...list, job]);
    },
    [projectRef, setJobs],
  );

  useEffect(() => {
    if (queuePaused) return;
    // Count only jobs whose handle is actually live; anything persisted as "rendering" from a
    // previous session was already rewritten to "failed" on load.
    let active = 0;
    for (const job of jobs) if (handles.current.has(job.id)) active += 1;
    const slots = MAX_CONCURRENT_RENDERS - active;
    if (slots <= 0) return;
    const nexts = jobs.filter((job) => job.status === "queued").slice(0, slots);

    for (const next of nexts) {
      const currentSettings = settingsRef.current;
      let lastReport = 0;
      const render = startRender(next.project, {
        height: currentSettings.exportHeight,
        fps: currentSettings.exportFps,
        format: currentSettings.exportFormat,
        onWarning: (message) => toast(message, "info"),
      }, (progress) => {
        const now = performance.now();
        if (now - lastReport < 250 && progress.progress < 1) return;
        lastReport = now;
        patchJob(next.id, { progress: progress.progress, fps: Math.round(progress.fps), remaining: progress.remaining });
      });
      handles.current.set(next.id, render);
      patchJob(next.id, { status: "rendering", startedAt: Date.now(), progress: 0, failure: null });

      render.done
        .then(async ({ blob, mime }) => {
          let key = "";
          try {
            key = `out:${next.id}`;
            await putBlob(key, blob);
            // Thumbnail generation is cosmetic — a failure here must not fail the render.
            const thumb = await makeVideoThumb(blob).catch(() => null);
            if (thumb) await putBlob(`renderthumb:${next.id}`, thumb).catch(() => {});
            let autoSaved: "download" | "folder" | undefined;
            if (currentSettings.autoDownloadRenders) {
              const ext = mime?.includes("mp4") ? "mp4" : "webm";
              const name = `${safeFileName(next.fileName)}.${ext}`;
              const saved = await saveRenderToFolder(name, blob);
              if (saved === "saved") autoSaved = "folder";
              else {
                // No folder chosen (or no permission yet): hand it to the system's Downloads folder.
                downloadBlob(blob, name);
                autoSaved = "download";
              }
            }
            patchJob(next.id, { status: "done", progress: 1, remaining: 0, finishedAt: Date.now(), outputKey: key, mime, size: blob.size, autoSaved });
            if (next.project.clipId) updateClip(next.project.clipId, { renderedAt: Date.now() });
            toast(`Rendered “${next.title}”`, "success", { label: "Show", run: showQueue });
          } catch (error) {
            // The render itself succeeded; persisting/saving it failed. Keep the job failed
            // with a precise reason instead of losing the finished video silently.
            patchJob(next.id, { status: "failed", failure: `Rendered, but saving it failed: ${(error as Error)?.message ?? "unknown error"}`, finishedAt: Date.now() });
            toast(`Rendered “${next.title}”, but saving it failed`, "error");
          }
        })
        .catch((error: Error) => {
          if (error instanceof RenderCancelled) {
            patchJob(next.id, { status: "cancelled", finishedAt: Date.now() });
          } else {
            patchJob(next.id, { status: "failed", failure: error.message, finishedAt: Date.now() });
            toast(`Render failed: ${error.message}`, "error");
          }
        })
        .finally(() => {
          handles.current.delete(next.id);
          setJobs((list) => [...list]);
        });
    }
  }, [jobs, queuePaused, patchJob, setJobs, toast, updateClip, showQueue]);

  const setPausedAll = useCallback(
    (paused: boolean) => {
      setQueuePaused(paused);
      for (const [id, h] of handles.current) {
        if (paused) {
          if (!h.canPause()) continue;
          h.pause();
          patchJob(id, { status: "paused" });
        } else {
          h.resume();
          patchJob(id, { status: "rendering" });
        }
      }
    },
    [patchJob],
  );

  const cancelJob = useCallback(
    (id: string) => {
      const live = handles.current.get(id);
      if (live) live.cancel();
      else patchJob(id, { status: "cancelled" as JobStatus });
    },
    [patchJob],
  );
  const retryJob = useCallback(
    (id: string) => patchJob(id, { status: "queued", progress: 0, failure: null, fps: 0, startedAt: null, finishedAt: null }),
    [patchJob],
  );
  const moveJob = useCallback(
    (id: string, direction: -1 | 1) =>
      setJobs((list) => {
        const index = list.findIndex((job) => job.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= list.length) return list;
        const reordered = [...list];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        return reordered;
      }),
    [setJobs],
  );
  const markDownloaded = useCallback(
    (id: string) => setJobs((list) => list.map((job) => (job.id === id ? { ...job, autoSaved: job.autoSaved || "download" } : job))),
    [setJobs],
  );

  const removeJob = useCallback(
    async (id: string) => {
      const job = jobs.find((item) => item.id === id);
      handles.current.get(id)?.cancel();
      setJobs((list) => list.filter((item) => item.id !== id));
      if (job?.outputKey) await deleteBlob(job.outputKey).catch(() => {});
      await deleteBlob(`renderthumb:${id}`).catch(() => {});
    },
    [jobs, setJobs],
  );

  return { jobs, enqueue, cancelJob, retryJob, moveJob, removeJob, markDownloaded, queuePaused, setQueuePaused: setPausedAll };
}
