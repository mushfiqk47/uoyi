import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../lib/types";
import { MediaPool } from "../lib/playback";
import { projectDuration } from "../lib/project";
import { drawFrame, frameReady } from "../lib/compositor";

/** The Editor's clock. Time lives outside React so only the playhead and timecode re-render. */
export class Clock {
  time = 0;
  playing = false;
  private listeners = new Set<() => void>();
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn();
  }
}

export function useClock(clock: Clock): { time: number; playing: boolean } {
  const [, force] = useState(0);
  useEffect(() => clock.subscribe(() => force((n) => (n + 1) % 1e9)), [clock]);
  return { time: clock.time, playing: clock.playing };
}

export interface Player {
  clock: Clock;
  pool: MediaPool;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  duration: number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
}

export const PREVIEW_W = 720;
export const PREVIEW_H = 1280;

export function usePlayer(project: Project): Player {
  const clockRef = useRef<Clock>(null as unknown as Clock);
  clockRef.current ??= new Clock();
  const clock = clockRef.current;
  const poolRef = useRef<MediaPool>(null as unknown as MediaPool);
  poolRef.current ??= new MediaPool();
  const pool = poolRef.current;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const duration = projectDuration(project);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const forceSync = useRef(true);
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    pool.ensure(project.media).then(() => {
      forceSync.current = true;
      wakeRef.current();
    });
  }, [project.media, pool]);

  useEffect(() => {
    wakeRef.current();
  }, [project]);

  useEffect(() => () => pool.dispose(), [pool]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    // Redraw only when something actually changed, and stop scheduling rAF once paused and
    // settled so an idle editor uses zero background CPU/GPU frames.
    let drawnProject: Project | null = null;
    let drawnAt = -1;
    let wasReady = false;
    let active = false;

    const schedule = () => {
      if (active) return;
      active = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    wakeRef.current = schedule;

    const loop = (now: number) => {
      active = false;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = projectRef.current;
      const d = durationRef.current;
      let stateChanged = false;
      if (clock.playing) {
        clock.time += dt;
        stateChanged = true;
        if (clock.time >= d) {
          clock.time = d;
          clock.playing = false;
        }
      }
      if (clock.time > d) {
        clock.time = d;
        stateChanged = true;
      }
      const moved = pool.sync(p, clock.time, clock.playing, forceSync.current);
      const forced = forceSync.current;
      forceSync.current = false;

      const c = canvasRef.current;
      if (c && (!ctxRef.current || ctxRef.current.canvas !== c)) {
        ctxRef.current = c.getContext("2d", { alpha: false });
      }
      const ctx = ctxRef.current;
      let ready = true;
      if (c && ctx) {
        ready = frameReady(p, clock.time, pool.visuals);
        if (ready && (clock.playing || moved || forced || !wasReady || clock.time !== drawnAt || p !== drawnProject)) {
          drawFrame(ctx, c.width, c.height, { project: p, time: clock.time, duration: d, visuals: pool.visuals });
          drawnProject = p;
          drawnAt = clock.time;
        }
        wasReady = ready;
      }
      if (stateChanged || moved || forced) {
        clock.emit();
      }
      // Keep running while playing, while a seeked video frame is still decoding, or while a sync changed state.
      if (clock.playing || !ready || moved || forced) {
        schedule();
      }
    };

    schedule();
    return () => {
      active = false;
      cancelAnimationFrame(raf);
      pool.pauseAll();
    };
  }, [clock, pool]);

  const play = useCallback(() => {
    if (clock.time >= durationRef.current - 0.02) clock.time = 0;
    clock.playing = true;
    forceSync.current = true;
    clock.emit();
    wakeRef.current();
  }, [clock]);

  const pause = useCallback(() => {
    clock.playing = false;
    clock.emit();
  }, [clock]);

  const toggle = useCallback(() => {
    if (clock.playing) pause();
    else play();
  }, [clock, pause, play]);

  const seek = useCallback(
    (t: number) => {
      clock.time = Math.max(0, Math.min(durationRef.current, t));
      forceSync.current = true;
      clock.emit();
      wakeRef.current();
    },
    [clock],
  );

  // Stable identity: consumers pass `player` into effect deps, so a fresh object on every
  // render would re-add the keyboard listener and restart the facecam timer continuously.
  return useMemo<Player>(
    () => ({ clock, pool, canvasRef, duration, play, pause, toggle, seek }),
    [clock, pool, duration, play, pause, toggle, seek],
  );
}
