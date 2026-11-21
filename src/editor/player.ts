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

export const PREVIEW_W = 540;
export const PREVIEW_H = 960;

export function usePlayer(project: Project): Player {
  const clockRef = useRef<Clock>(null as unknown as Clock);
  clockRef.current ??= new Clock();
  const clock = clockRef.current;
  const poolRef = useRef<MediaPool>(null as unknown as MediaPool);
  poolRef.current ??= new MediaPool();
  const pool = poolRef.current;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const duration = projectDuration(project);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const forceSync = useRef(true);

  useEffect(() => {
    pool.ensure(project.media).then(() => (forceSync.current = true));
  }, [project.media, pool]);

  useEffect(() => () => pool.dispose(), [pool]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastEmit = 0;
    // Redraw only when something actually changed. Repainting an identical paused frame every
    // rAF churned the canvas (clear + full redraw at 60fps) and could race a frame that had
    // just finished loading, showing a stale or blank picture — reads as flicker while scrubbing.
    let drawnProject: Project | null = null;
    let drawnAt = -1;
    let wasReady = true;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = projectRef.current;
      const d = durationRef.current;
      if (clock.playing) {
        clock.time += dt;
        if (clock.time >= d) {
          clock.time = d;
          clock.playing = false;
        }
      }
      if (clock.time > d) clock.time = d;
      const moved = pool.sync(p, clock.time, clock.playing, forceSync.current);
      const forced = forceSync.current;
      forceSync.current = false;
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        const ready = frameReady(p, clock.time, pool.visuals);
        if (ready && (clock.playing || moved || forced || !wasReady || clock.time !== drawnAt || p !== drawnProject)) {
          drawFrame(ctx, c.width, c.height, { project: p, time: clock.time, duration: d, visuals: pool.visuals });
          drawnProject = p;
          drawnAt = clock.time;
        }
        wasReady = ready;
      }
      if (clock.playing || now - lastEmit > 250) {
        lastEmit = now;
        clock.emit();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      pool.pauseAll();
    };
  }, [clock, pool]);

  const play = useCallback(() => {
    if (clock.time >= durationRef.current - 0.02) clock.time = 0;
    clock.playing = true;
    forceSync.current = true;
    clock.emit();
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
