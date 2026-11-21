import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Disc, HelpCircle, ListVideo, MonitorPlay, Scissors, Settings2 } from "lucide-react";
import { useLibrary, useQueue, useShellStore, type Screen } from "../store";

const TABS: { id: Screen; label: string; Icon: typeof MonitorPlay }[] = [
  { id: "viewer", label: "Viewer", Icon: MonitorPlay },
  { id: "recommend", label: "Records", Icon: Disc },
  { id: "clips", label: "Clips", Icon: Scissors },
  { id: "editor", label: "Editor", Icon: Clapperboard },
  { id: "queue", label: "Queue", Icon: ListVideo },
  { id: "settings", label: "Settings", Icon: Settings2 },
];

export function TopBar({ onHelp }: { onHelp: () => void }) {
  // Subscribe to useShellStore instead of useStore so toast/project edits never re-render the header.
  const { screen, go } = useShellStore();
  const { clips } = useLibrary();
  const { jobs } = useQueue();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const { fresh, recordings } = useMemo(() => {
    let f = 0;
    let r = 0;
    for (const c of clips) {
      if (c.removedAt) continue;
      if (c.recording) r += 1;
      else if (!c.edited) f += 1;
    }
    return { fresh: f, recordings: r };
  }, [clips]);

  const active = useMemo(() => {
    let count = 0;
    for (const j of jobs) {
      if (j.status === "queued" || j.status === "rendering" || j.status === "paused") count += 1;
    }
    return count;
  }, [jobs]);

  // One highlight that slides between tabs (TopBar's useSlidingPill).
  useLayoutEffect(() => {
    const place = () => {
      const a = navRef.current?.querySelector<HTMLElement>(`[data-tab="${screen}"]`);
      if (a) setPill({ left: a.offsetLeft, width: a.offsetWidth });
    };
    place();
    document.fonts.ready.then(place);
    const ro = new ResizeObserver(place);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [screen, fresh, recordings, active]);

  return (
    <header className="top">
      <div className="left">
        <button className="brand" onClick={() => go("viewer")} aria-label="Clipweave, go to Viewer">
          <span className="logo" aria-hidden="true" />
          <b>Clipweave</b>
        </button>
      </div>
      <nav className="nav" ref={navRef} aria-label="Screens">
        {pill && <span className="nav-pill" aria-hidden="true" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />}
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} data-tab={id} className={screen === id ? "on" : ""} aria-current={screen === id ? "page" : undefined} onClick={() => go(id)}>
            <Icon className="nav-icon" />
            <span className="nav-word">{label}</span>
            {id === "recommend" && recordings > 0 && <span className="nav-count">{recordings}</span>}
            {id === "clips" && fresh > 0 && <span className="nav-count">{fresh}</span>}
            {id === "queue" && active > 0 && <span className="nav-count busy">{active}</span>}
          </button>
        ))}
      </nav>
      <div className="right">
        <button className="btn ghost sm" onClick={onHelp}>
          <HelpCircle className="ic" />
          <span className="help-word">How it works</span>
        </button>
      </div>
    </header>
  );
}
