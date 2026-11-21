import { useEffect, useRef, type RefObject } from "react";
import type { Stream } from "../../lib/types";
import type { Settings } from "../../lib/settings";
import type { Screen } from "../../store";
import type { MomentVerdict } from "../../lib/ai/openai";
import { clusterMoments } from "../../lib/ai/openai";
import { logActivity } from "../../lib/activity";
import { uid } from "../../lib/util";
import type { TileApi } from "./types";

type Toast = (text: string, tone?: "info" | "error" | "success", action?: { label: string; run: () => void }) => void;

/** Runs one AI pass per interval over every ready stream, groups same-moment spikes and saves
 *  the clip-worthy ones. The caller owns the streams and the tile registry. */
export function useAiAutoClip({
  streams,
  settings,
  tiles,
  toast,
  go,
  noteAiError,
  clearAiError,
}: {
  streams: Stream[];
  settings: Settings;
  tiles: RefObject<Map<string, TileApi>>;
  toast: Toast;
  go: (s: Screen) => void;
  noteAiError: (id: string, title: string, msg: string) => void;
  clearAiError: (id: string) => void;
}) {
  const aiRunning = useRef(false);
  const autoClipArmed = useRef(false);
  // `streams` changes identity on any tile update (level change, re-resolve). Reading it from
  // a ref keeps those updates from clearing and restarting the interval, which could otherwise
  // postpone AI checks indefinitely on a busy stream.
  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!settings.aiAutoClip) {
      autoClipArmed.current = false;
      return;
    }
    const armed = !autoClipArmed.current;
    autoClipArmed.current = true;
    const tick = async () => {
      if (aiRunning.current) return;
      aiRunning.current = true;
      try {
        // First pass: judge every stream, collect the clip-worthy ones.
        const findings: Array<{ s: Stream; api: TileApi; verdict: MomentVerdict; transcript: string }> = [];
        let checked = 0;
        for (const s of streamsRef.current) {
          const api = tiles.current?.get(s.id);
          if (!api || !api.ready()) continue;
          try {
            const out = await api.analyze();
            checked += 1;
            clearAiError(s.id);
            if (!out) {
              logActivity("info", `AI ${s.title}: no usable audio or speech — skipping`);
            } else {
              const enough = out.verdict.clip && out.verdict.score >= settingsRef.current.aiClipThreshold;
              logActivity(enough ? "success" : "info", `AI ${out.verdict.score}/10 — ${s.title}${enough ? " — clip-worthy" : ""}`);
              if (enough) findings.push({ s, api, verdict: out.verdict, transcript: out.transcript });
            }
          } catch (err) {
            const msg = String((err as Error)?.message || err).split("\n").filter(Boolean).pop()?.slice(0, 120) || "unknown error";
            noteAiError(s.id, s.title, msg);
            logActivity("error", `AI can't listen to ${s.title}: ${msg}`);
          }
        }
        if (checked === 0) logActivity("info", "AI check: no streams ready yet (buffering or offline)");
        // Cluster same-moment spikes across streams with one AI call (only when ≥2 fired).
        let clusters: number[][] = findings.map((_, i) => [i]);
        if (findings.length >= 2) {
          try {
            clusters = await clusterMoments(settingsRef.current, findings.map((f) => ({ streamTitle: f.s.title, transcript: f.transcript, reason: f.verdict.reason, score: f.verdict.score })));
            const grouped = clusters.filter((m) => m.length >= 2);
            if (grouped.length) logActivity("info", `Same moment on ${grouped.length === 1 ? grouped[0].map((i) => findings[i].s.title).join(" & ") : `${grouped.length} stream pairs`}`);
          } catch {
            /* clustering is best-effort; save the clips ungrouped */
          }
        }
        let savedCount = 0;
        for (const members of clusters) {
          const group = members.length >= 2 ? { groupId: uid("g"), streams: members.map((i) => findings[i].s.title) } : null;
          for (const i of members) {
            const { s, api, verdict } = findings[i];
            try {
              const saved = await api.clip({
                note: `[AI ${verdict.score}/10] ${verdict.title}${verdict.reason ? ` — ${verdict.reason}` : ""}${group ? ` (also on ${group.streams.join(" & ")})` : ""}`,
                score: verdict.score,
                title: verdict.title,
                viral: verdict.viral,
                ...(group ?? {}),
              });
              if (saved) {
                savedCount += 1;
                logActivity("success", `Clip saved — ${verdict.title} (${s.title})`);
              }
            } catch {
              /* capture failed on this stream; the others still save */
            }
          }
        }
        if (savedCount) {
          toast(`AI saved ${savedCount} clip${savedCount === 1 ? "" : "s"} to Clips`, "success", { label: "Clips", run: () => go("clips") });
        }
      } finally {
        aiRunning.current = false;
      }
    };
    // Run one check immediately when the toggle flips on (and on load with it on), then on the interval.
    if (armed) void tick();
    const timer = window.setInterval(() => void tick(), Math.max(3, settingsRef.current.aiClipInterval) * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [settings.aiAutoClip, settings.aiClipInterval, toast, go, noteAiError, clearAiError, tiles]);
}
