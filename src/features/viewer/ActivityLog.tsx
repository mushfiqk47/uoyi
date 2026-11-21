import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { clearActivity, getActivity, subscribeActivity } from "../../lib/activity";

export function ActivityLog() {
  const entries = useSyncExternalStore(subscribeActivity, getActivity);
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);
  return (
    <div className={`activity-log${open ? "" : " collapsed"}`}>
      <div className="activity-log-bar">
        <button className="activity-log-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="activity-log-body">
          <span className="activity-log-pip" aria-hidden="true" />
          <span className="activity-log-title">Activity</span>
          <span className="activity-log-count tabular">{entries.length}</span>
          {open ? <ChevronDown className="ic" /> : <ChevronUp className="ic" />}
        </button>
        <button className="activity-log-clear" onClick={clearActivity}>Clear</button>
      </div>
      {open && (
        <div className="activity-log-body" id="activity-log-body" ref={bodyRef} role="log" aria-label="Activity log">
          {entries.length === 0 ? (
            <p className="activity-empty">Quiet in here. Recordings, AI checks, saved clips and errors will appear as they happen.</p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className={`activity-line ${e.tone}`}>
                <time className="activity-time tabular">{new Date(e.at).toLocaleTimeString([], { hour12: false })}</time>
                <span className="activity-text">{e.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
