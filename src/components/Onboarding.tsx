import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Clapperboard, Cpu, HardDrive, MonitorPlay, Scissors, ShieldCheck, Wrench } from "lucide-react";
import { Modal } from "./ui";
import { useStore } from "../store";
import { fetchSetupStatus, runSetupInstall, type SetupItem, type SetupJob, type SystemProfile } from "../platform/api/setup";
import { fmtBytes } from "../lib/util";

const WIZARD_STEPS = [
  { id: "readiness", label: "System check", Icon: Wrench },
  { id: "privacy", label: "Privacy & AI", Icon: ShieldCheck },
  { id: "workflow", label: "Workflow", Icon: MonitorPlay },
] as const;

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { updateSettings, go, settings, toast } = useStore();
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<SetupItem[]>([]);
  const [jobs, setJobs] = useState<Record<string, SetupJob>>({});
  const [system, setSystem] = useState<SystemProfile | undefined>(undefined);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchSetupStatus();
      setItems(data.items || []);
      setJobs((prev) => ({ ...prev, ...(data.jobs || {}) }));
      setSystem(data.system);
    } catch {
      /* backend may still be warming up */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const installTool = useCallback(
    async (id: string, label: string) => {
      setBusyIds((list) => (list.includes(id) ? list : [...list, id]));
      try {
        await runSetupInstall(id, (s) => setJobs((prev) => ({ ...prev, [id]: s })));
        toast(`${label} is ready.`, "success");
        await refresh();
      } catch (e) {
        toast(`${label}: ${(e as Error).message || "installation failed"}`, "error");
        await refresh();
      } finally {
        setBusyIds((list) => list.filter((x) => x !== id));
      }
    },
    [refresh, toast],
  );

  const missingRequired = items.filter((i) => !i.installed && (i.tier === "required" || i.required));
  const installRequired = useCallback(async () => {
    for (const item of missingRequired) {
      if (!busyIds.includes(item.id)) {
        await installTool(item.id, item.label);
      }
    }
  }, [missingRequired, busyIds, installTool]);

  const finish = () => {
    updateSettings({ setupDone: true });
    go("viewer");
    onClose();
  };

  const tierLabel = (item: SetupItem) => item.tier ?? (item.required ? "required" : "optional");
  const tiers: Array<{ key: "required" | "recommended" | "optional"; title: string; hint: string }> = [
    { key: "required", title: "Required", hint: "Needed for core recording, clipping, and video exports." },
    { key: "recommended", title: "Recommended", hint: "Unlocks media link imports and offline word-level speech captions." },
    { key: "optional", title: "Optional", hint: "Extra live stream capture, visual scene cuts, and facecam framing." },
  ];

  const ramGb = system?.totalRamBytes ? `${Math.round(system.totalRamBytes / 1024 ** 3)} GB RAM` : "";
  const diskFree = system?.freeWorkspaceBytes ? fmtBytes(system.freeWorkspaceBytes) : "";

  return (
    <Modal
      title="Welcome to ClipWeave"
      description="Zero-config setup for watching streams, discovering highlights, editing 9:16 shorts, and exporting privately."
      onClose={finish}
      width={660}
      footer={
        <>
          <div className="steps-dots" aria-hidden>
            {WIZARD_STEPS.map((s, k) => (
              <i key={s.id} className={k === step ? "on" : ""} />
            ))}
          </div>
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < WIZARD_STEPS.length - 1 ? (
            <button className="btn accent" onClick={() => setStep(step + 1)}>
              Next <ArrowRight className="ic" />
            </button>
          ) : (
            <button className="btn accent" onClick={finish}>
              Start using ClipWeave <ArrowRight className="ic" />
            </button>
          )}
        </>
      }
    >
      <ol className="onboard">
        {WIZARD_STEPS.map((s, k) => (
          <li key={s.id} className={k === step ? "on" : k < step ? "done" : ""}>
            <button type="button" onClick={() => setStep(k)}>
              <s.Icon className="ic" />
              <span>{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="wizard-pane" key="readiness">
          {system && (
            <div className="hw-grid">
              <div className="hw-stat">
                <Cpu className="ic" />
                <div>
                  <b>{system.platform} ({system.arch})</b>
                  <small>{system.cpus} threads{ramGb ? ` · ${ramGb}` : ""}</small>
                </div>
              </div>
              <div className="hw-stat">
                <Clapperboard className="ic" />
                <div>
                  <b>{system.gpu?.hardware ? `${system.gpu.label}` : "CPU Encoding"}</b>
                  <small>{system.gpu?.encoder || "libx264"}</small>
                </div>
              </div>
              <div className="hw-stat">
                <HardDrive className="ic" />
                <div>
                  <b>{diskFree ? `${diskFree} free` : "Workspace ready"}</b>
                  <small title={system.workspaceDir}>{system.workspaceDir || "Local workspace"}</small>
                </div>
              </div>
            </div>
          )}

          <div className="wizard-actions-bar">
            {missingRequired.length > 0 ? (
              <button
                type="button"
                className="btn accent sm"
                disabled={busyIds.length > 0}
                onClick={() => void installRequired()}
              >
                {busyIds.length > 0 ? "Installing…" : `Install required (${missingRequired.length})`}
              </button>
            ) : (
              <span className="chip success">
                <CheckCircle2 className="ic" /> Core requirements ready
              </span>
            )}
            <button type="button" className="btn plain sm" disabled={busyIds.length > 0} onClick={() => void refresh()}>
              Re-check system
            </button>
          </div>

          {loaded && items.length === 0 && (
            <p className="muted">Local helper is starting up. You can still continue and check Settings → Setup later.</p>
          )}

          <div className="wizard-tiers">
            {tiers.map(({ key, title, hint }) => {
              const list = items.filter((item) => tierLabel(item) === key);
              if (!list.length) return null;
              return (
                <section key={key} className="setup-tier">
                  <div className="setup-tier-head">
                    <b>{title}</b>
                    <small className="muted">{hint}</small>
                  </div>
                  <div className="setup-tier-list">
                    {list.map((item) => {
                      const isBusy = busyIds.includes(item.id);
                      const job = jobs[item.id];
                      return (
                        <div key={item.id} className="setup-tier-item">
                          <div className="grow">
                            <div className="row">
                              <b>{item.label}</b>
                              {item.sizeLabel && !item.installed && <small className="muted">{item.sizeLabel}</small>}
                              <span className={`chip ${item.installed ? "success" : key === "required" ? "danger" : ""}`}>
                                {item.installed ? (item.source === "app" ? "app bin" : "ready") : "not installed"}
                              </span>
                            </div>
                            <small className="muted">{item.note}{item.version ? ` · ${item.version}` : ""}</small>
                            {isBusy && job && job.progress > 0 && (
                              <progress value={Math.min(100, job.progress)} max={100} aria-label={`${item.label} progress`} />
                            )}
                            {isBusy && job?.log && <small className="muted">{job.log}</small>}
                          </div>
                          {!item.installed && (
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={isBusy}
                              onClick={() => void installTool(item.id, item.label)}
                            >
                              {isBusy ? "Installing…" : "Install"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-pane" key="privacy">
          <p className="muted">
            Your video files, recordings, and renders stay in your local workspace folder. Choose how AI clip discovery and speech transcription run:
          </p>
          <div className="privacy-choices">
            <button
              type="button"
              className={`privacy-choice card${settings.localOnlyMode ? " on" : ""}`}
              onClick={() => updateSettings({ localOnlyMode: true, aiProfile: "local" })}
            >
              <div>
                <b>Local-Only Privacy Mode</b>
                <p>Strictly keeps video frames, audio transcripts, and AI scoring on your own machine (local Ollama + local speech model). Blocks cloud AI calls.</p>
              </div>
              <span className={`chip ${settings.localOnlyMode ? "success" : ""}`}>
                {settings.localOnlyMode ? "Selected" : "On-device"}
              </span>
            </button>
            <button
              type="button"
              className={`privacy-choice card${!settings.localOnlyMode ? " on" : ""}`}
              onClick={() => updateSettings({ localOnlyMode: false })}
            >
              <div>
                <b>Hybrid / Cloud AI Mode</b>
                <p>Processes video and cuts locally, and sends sampled frames or transcript text only to the AI endpoint you choose in Settings → AI &amp; Privacy.</p>
              </div>
              <span className={`chip ${!settings.localOnlyMode ? "success" : ""}`}>
                {!settings.localOnlyMode ? "Selected" : "Flexible"}
              </span>
            </button>
          </div>
          <div className="onboard-note">
            <span>
              Downloads and optional models are never fetched silently in the background — you decide when to install tools or call external AI.
            </span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-pane" key="workflow">
          <div className="onboard-body">
            <MonitorPlay className="ic" />
            <div>
              <h3>1. Watch &amp; Record</h3>
              <p>Open up to four live streams side by side or capture a browser tab. ClipWeave keeps a rolling {settings.captureSeconds}s buffer while you watch.</p>
            </div>
          </div>
          <div className="onboard-body">
            <Scissors className="ic" />
            <div>
              <h3>2. Clip &amp; Discover Highlights</h3>
              <p>Press Clip on any live moment, or drop any video or link into Clips → Create AI clips to extract viral-ready highlights automatically.</p>
            </div>
          </div>
          <div className="onboard-body">
            <Clapperboard className="ic" />
            <div>
              <h3>3. Edit 9:16 &amp; Export</h3>
              <p>Frame game + facecam split layouts, customize word-by-word captions, save projects, and export MP4 files directly to your Exports folder.</p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

