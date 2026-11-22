import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Stream } from "../../lib/types";
import type { Settings } from "../../lib/settings";
import type { Screen } from "../../store";
import type { MomentVerdict } from "../../lib/ai/openai";
import { clusterMoments } from "../../lib/ai/openai";
import { uid } from "../../lib/util";
import type { TileApi } from "./types";

type Toast = (text: string, tone?: "info" | "error" | "success", action?: { label: string; run: () => void }) => void;

/** Runs one AI pass per interval over every ready stream (plus energy-spike triggers), groups
 *  same-moment spikes and saves clip-worthy moments cleanly. */
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
  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const runCheck = useCallback(
    async (targetIds?: Set<string>) => {
      if (aiRunning.current || !settingsRef.current.aiAutoClip) return;
      aiRunning.current = true;
      try {
        const findings: Array<{ s: Stream; api: TileApi; verdict: MomentVerdict; transcript: string }> = [];
        for (const s of streamsRef.current) {
          if (targetIds && !targetIds.has(s.id)) continue;
          const api = tiles.current?.get(s.id);
          if (!api || !api.ready()) continue;
          try {
            const out = await api.analyze();
            clearAiError(s.id);
            if (out) {
              const enough = out.verdict.clip && out.verdict.score >= settingsRef.current.aiClipThreshold;
              if (enough) findings.push({ s, api, verdict: out.verdict, transcript: out.transcript });
            }
          } catch (err) {
            const msg = String((err as Error)?.message || err).split("\n").filter(Boolean).pop()?.slice(0, 120) || "unknown error";
            noteAiError(s.id, s.title, msg);
          }
        }
        let clusters: number[][] = findings.map((_, i) => [i]);
        if (findings.length >= 2) {
          try {
            clusters = await clusterMoments(
              settingsRef.current,
              findings.map((f) => ({ streamTitle: f.s.title, transcript: f.transcript, reason: f.verdict.reason, score: f.verdict.score })),
            );
          } catch {
            /* clustering is best-effort */
          }
        }
        let savedCount = 0;
        for (const members of clusters) {
          const group = members.length >= 2 ? { groupId: uid("g"), streams: members.map((i) => findings[i].s.title) } : null;
          for (const i of members) {
            const { api, verdict } = findings[i];
            try {
              const saved = await api.clip({
                note: `[AI ${verdict.score}/10] ${verdict.title}${verdict.reason ? ` — ${verdict.reason}` : ""}${group ? ` (also on ${group.streams.join(" & ")})` : ""}`,
                score: verdict.score,
                title: verdict.title,
                viral: verdict.viral,
                ...(group ?? {}),
              });
              if (saved) savedCount += 1;
            } catch {
              /* capture failed on this stream; others still save */
            }
          }
        }
        if (savedCount) {
          toast(`AI saved ${savedCount} clip${savedCount === 1 ? "" : "s"} to Clips`, "success", { label: "Clips", run: () => go("clips") });
        }
      } finally {
        aiRunning.current = false;
      }
    },
    [tiles, toast, go, noteAiError, clearAiError],
  );

  useEffect(() => {
    if (!settings.aiAutoClip) {
      autoClipArmed.current = false;
      return;
    }
    const armed = !autoClipArmed.current;
    autoClipArmed.current = true;
    if (armed) void runCheck();
    const timer = window.setInterval(() => void runCheck(), Math.max(3, settingsRef.current.aiClipInterval) * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [settings.aiAutoClip, settings.aiClipInterval, runCheck]);

  return useCallback((streamId: string) => {
    void runCheck(new Set([streamId]));
  }, [runCheck]);
}
