import { useCallback, useEffect, useState } from "react";
import { Activity, Check, Cpu, ExternalLink, FolderOpen, HardDrive, KeyRound, Palette, Scissors, Clapperboard, Download, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { useLibrary, useQueue, useStore } from "../store";
import { chatCompletion, tryParseJson } from "../lib/ai/openai";
import { loadFeedbackStats, resetFeedbackStats } from "../lib/ai/feedback";
import { listSpeechModels, installSpeechModel, type SpeechModel } from "../platform/api/models";
import { apiJson, apiPostJson } from "../platform/api/client";
import { fetchSetupStatus, runSetupInstall, type SetupItem, type SetupJob, type SystemProfile } from "../platform/api/setup";
import {
  fetchDiagnostics,
  fetchSecretsStatus,
  fetchWorkspaceConfig,
  saveWorkspaceConfig,
  saveWorkspaceSecrets,
  type DiagnosticsReport,
  type SecretsStatus,
  type WorkspaceSummary,
} from "../platform/api/workspace";
import { chooseWorkspaceDirectory, openExternalUrl } from "../platform/desktop";
import { ACCENTS, BACKGROUNDS, THEMES, type ButtonStyle, type Settings as S } from "../lib/settings";
import { AutoTextarea, Field, Modal, Seg, Switch } from "../components/ui";
import { clearBlobs } from "../lib/db";
import { fileNameFor } from "../lib/project";
import { downloadBlob, fmtBytes } from "../lib/util";
import { canPickFolder, clearRenderFolder, getRenderFolder, pickRenderFolder } from "../lib/renderFolder";

interface ServerHealth {
  ok: boolean;
  ffmpeg: boolean;
  ytDlp: boolean;
  nemo: boolean;
  opencv: boolean;
  streamlink: boolean;
  scenedetect: boolean;
  sceneBackend: "pyscenedetect" | "ffmpeg" | null;
  gemini: boolean;
  nvenc: boolean;
  audiocpp?: boolean;
  audiocppParakeet?: boolean;
}

function useServerHealth(): ServerHealth | null {
  const [health, setHealth] = useState<ServerHealth | null>(null);
  useEffect(() => {
    let alive = true;
    apiJson<ServerHealth>("/api/health")
      .then((h) => {
        if (alive && h && typeof h === "object") setHealth(h);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return health;
}

type Section = "setup" | "appearance" | "capture" | "editor" | "ai" | "export" | "data" | "diagnostics";

const SECTIONS: { id: Section; label: string; Icon: typeof Palette }[] = [
  { id: "setup", label: "Setup & Hardware", Icon: Wrench },
  { id: "appearance", label: "Themes", Icon: Palette },
  { id: "capture", label: "Clipping", Icon: Scissors },
  { id: "editor", label: "Editor", Icon: Clapperboard },
  { id: "ai", label: "AI & Privacy", Icon: Sparkles },
  { id: "export", label: "Rendering", Icon: Download },
  { id: "data", label: "Folders & Storage", Icon: HardDrive },
  { id: "diagnostics", label: "Diagnostics & Updates", Icon: Activity },
];

function SettingRow({ title, desc, children, wide }: { title: string; desc?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`set-row${wide ? " set-row-wide" : ""}`}>
      <div className="grow">
        <b>{title}</b>
        {desc && <p>{desc}</p>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

export function Settings() {
  const [section, setSection] = useState<Section>("setup");
  const health = useServerHealth();
  return (
    <main className="page settings">
      <div className="pagehead">
        <div>
          <h1>Settings</h1>
          <p>Preferences, hardware readiness, folders, privacy guardrails, and diagnostics.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)}>
              <Icon className="ic" /> {label}
            </button>
          ))}
        </nav>
        <div className="settings-panel" key={section}>
          {section === "setup" && <SetupPanel />}
          {section === "appearance" && <Appearance />}
          {section === "capture" && <Capture />}
          {section === "editor" && <EditorDefaults />}
          {section === "ai" && <AiSettings health={health} />}
          {section === "export" && <Export health={health} />}
          {section === "data" && <Data />}
          {section === "diagnostics" && <DiagnosticsPanel />}
        </div>
      </div>
    </main>
  );
}

/** Settings → Setup: checks the whole system and installs anything missing — the audio.cpp
 *  runtime + caption model, FFmpeg, yt-dlp, and the optional pip tools — into the app's own
 *  folders, so the same flow works on any machine, Windows, Linux, or macOS. */
function SetupPanel() {
  const { toast } = useStore();
  const [items, setItems] = useState<SetupItem[]>([]);
  const [jobs, setJobs] = useState<Record<string, SetupJob>>({});
  const [system, setSystem] = useState<SystemProfile | undefined>(undefined);
  const [busy, setBusy] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchSetupStatus();
      setItems(data.items);
      setJobs((prev) => ({ ...prev, ...data.jobs }));
      setSystem(data.system);
    } catch {
      /* server may be starting */
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = useCallback(
    async (id: string, label: string) => {
      setBusy((b) => (b.includes(id) ? b : [...b, id]));
      try {
        await runSetupInstall(id, (s) => setJobs((prev) => ({ ...prev, [id]: s })));
        toast(`${label} is ready.`, "success");
        await refresh();
      } catch (e) {
        toast(`${label}: ${(e as Error).message || "setup failed"}`, "error");
        await refresh();
      } finally {
        setBusy((b) => b.filter((x) => x !== id));
      }
    },
    [refresh, toast],
  );

  const installAllMissing = useCallback(async () => {
    for (const item of items) {
      if (item.installed || !(item.tier === "required" || item.required) || busy.includes(item.id)) continue;
      await install(item.id, item.label);
    }
  }, [items, busy, install]);

  const pending = items.filter((i) => !i.installed && (i.tier === "required" || i.required));
  const tierOf = (item: SetupItem) => item.tier ?? (item.required ? "required" : "optional");
  const tiers: Array<{ key: "required" | "recommended" | "optional"; title: string }> = [
    { key: "required", title: "Required runtime & quality enhancements" },
    { key: "recommended", title: "Recommended media & speech tools" },
    { key: "optional", title: "Optional enhancements" },
  ];

  const sourceChip = (item: SetupItem) =>
    item.installed ? (
      <span className="chip success">{item.source === "app" ? "app bin" : "on PATH"}</span>
    ) : (
      <span className={`chip ${tierOf(item) === "required" ? "danger" : ""}`}>
        {tierOf(item) === "required" ? "required" : "not installed"}
      </span>
    );

  return (
    <>
      <h2 className="sec-title">Hardware &amp; readiness</h2>
      {system && (
        <div className="hw-grid">
          <div className="hw-stat card">
            <Cpu className="ic" />
            <div>
              <b>{system.platform} · {system.arch}</b>
              <small>{system.cpus} CPU threads · {Math.round(system.totalRamBytes / 1024 ** 3)} GB RAM</small>
            </div>
          </div>
          <div className="hw-stat card">
            <Clapperboard className="ic" />
            <div>
              <b>{system.gpu?.hardware ? system.gpu.label : "CPU H.264 Encoding"}</b>
              <small>{system.gpu?.encoder || "libx264"} · Python {system.pythonAvailable ? "detected" : "optional"}</small>
            </div>
          </div>
          <div className="hw-stat card">
            <HardDrive className="ic" />
            <div>
              <b>{system.freeWorkspaceBytes ? `${fmtBytes(system.freeWorkspaceBytes)} free` : "Workspace OK"}</b>
              <small title={system.workspaceDir}>{system.workspaceDir}</small>
            </div>
          </div>
        </div>
      )}

      <p className="muted set-intro">
        Installs tools cleanly inside ClipWeave's app data folder without editing system PATH variables.
      </p>
      <div className="row" style={{ marginBottom: 4 }}>
        <button className="btn accent sm" disabled={busy.length > 0 || pending.length === 0} onClick={() => void installAllMissing()}>
          {busy.length > 0 ? "Setting up…" : pending.length > 0 ? `Install required (${pending.length})` : "All required tools ready"}
        </button>
        <button className="btn plain sm" disabled={busy.length > 0} onClick={() => void refresh()}>
          Re-check system
        </button>
      </div>
      {loaded && items.length === 0 && (
        <div className="set-group card">
          <SettingRow title="Local backend unavailable" desc="Start the ClipWeave server to inspect and install system dependencies.">
            <span className="chip danger">offline</span>
          </SettingRow>
        </div>
      )}
      {tiers.map(({ key, title }) => {
        const list = items.filter((item) => tierOf(item) === key);
        if (!list.length) return null;
        return (
          <div key={key}>
            <h3 className="sec-title" style={{ marginBottom: 8 }}>{title}</h3>
            <div className="set-group card">
              {list.map((item) => {
                const job = jobs[item.id];
                const isBusy = busy.includes(item.id);
                return (
                  <SettingRow
                    key={item.id}
                    title={item.label}
                    desc={`${item.note}${item.version ? ` — ${item.version}` : ""}${item.sizeLabel && !item.installed ? ` (${item.sizeLabel})` : ""}`}
                  >
                    <div className="ai-stack">
                      <div className="row">
                        {sourceChip(item)}
                        <button
                          className="btn ghost sm"
                          disabled={isBusy || item.installed}
                          onClick={() => void install(item.id, item.label)}
                        >
                          {isBusy ? "Setting up…" : item.installed ? "Ready" : "Install"}
                        </button>
                      </div>
                      {isBusy && job && job.progress > 0 && (
                        <progress value={Math.min(100, job.progress)} max={100} aria-label={`${item.label} setup progress`} />
                      )}
                      {isBusy && job?.log && <small className="muted" role="status" aria-live="polite">{job.log}</small>}
                    </div>
                  </SettingRow>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Appearance() {
  const { settings, updateSettings } = useStore();
  return (
    <>
      <h2 className="sec-title">Theme</h2>
      <div className="looks">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`look card${settings.theme === t.id ? " on" : ""}`}
            data-palette={t.id === "mono" ? "mono" : "clipkit"}
            data-buttons={t.buttons}
            onClick={() => updateSettings({ theme: t.id, buttonStyle: t.buttons, accent: t.accent, background: null })}
            aria-pressed={settings.theme === t.id}
          >
            <div className="pv" style={t.id === "mono" ? { ["--brand" as string]: "#fafafa", ["--brand-rgb" as string]: "250,250,250" } : undefined}>
              <span className="pv-bar">
                <i />
                <i />
                <i />
              </span>
              <span className="pv-btns">
                <span className="btn accent sm">Clip</span>
                <span className="btn ghost sm">Edit</span>
              </span>
            </div>
            <div className="look-text">
              <b>{t.name}</b>
              <small>{t.blurb}</small>
            </div>
            {settings.theme === t.id && (
              <span className="look-check">
                <Check className="ic" />
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="set-group card">
        <SettingRow title="Accent" desc="Buttons, highlights, the playhead and the spoken-word colour for new captions.">
          <div className="swatches" role="radiogroup" aria-label="Accent">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={`swatch${settings.accent === a.value ? " on" : ""}`}
                style={{ background: a.value }}
                role="radio"
                aria-checked={settings.accent === a.value}
                aria-label={a.id}
                title={a.id}
                onClick={() => updateSettings({ accent: a.value })}
              />
            ))}
          </div>
        </SettingRow>
        <SettingRow title="Background" desc="The colour every screen sits on.">
          <div className="swatches" role="radiogroup" aria-label="Background">
            {BACKGROUNDS.map((b) => {
              const on = (settings.background ?? (settings.theme === "mono" ? "#111111" : "#18181b")) === b.value;
              return (
                <button
                  key={b.id}
                  className={`swatch bg${on ? " on" : ""}`}
                  style={{ background: b.value }}
                  role="radio"
                  aria-checked={on}
                  aria-label={b.id}
                  title={b.id}
                  onClick={() => updateSettings({ background: b.value })}
                />
              );
            })}
          </div>
        </SettingRow>
        <SettingRow title="Buttons" desc="The look of every button.">
          <Seg<ButtonStyle>
            label="Button style"
            value={settings.buttonStyle}
            onChange={(buttonStyle) => updateSettings({ buttonStyle })}
            options={[
              { value: "glint", label: "Glint" },
              { value: "classic", label: "Classic" },
              { value: "keycap", label: "Keycap" },
              { value: "mono", label: "Mono" },
            ]}
          />
        </SettingRow>
      </div>
    </>
  );
}

const SAVE_PRESETS = [30, 60, 120, 180, 300, 600, 900, 1800, 3600];

function RecordInterval() {
  const { settings, updateSettings } = useStore();
  const value = settings.recordSaveSeconds;
  const [custom, setCustom] = useState(value);
  const [showCustom, setShowCustom] = useState(!SAVE_PRESETS.includes(value));
  return (
    <div className="interval-ctl">
      <select
        className="select"
        aria-label="Auto-save recording interval"
        value={showCustom ? "custom" : value}
        onChange={(e) => {
          if (e.target.value === "custom") { setCustom(value); setShowCustom(true); }
          else { setShowCustom(false); updateSettings({ recordSaveSeconds: Number(e.target.value) }); }
        }}
      >
        {SAVE_PRESETS.map((s) => (
          <option key={s} value={s}>{s < 60 ? `${s} seconds` : `${s / 60} min`}</option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {showCustom && (
        <div className="row interval-custom">
          <input
            className="input"
            type="number"
            min={30}
            max={7200}
            step={5}
            value={custom}
            aria-label="Custom interval in seconds"
            onChange={(e) => {
              const n = Number(e.target.value);
              setCustom(n);
              if (Number.isFinite(n) && n >= 30 && n <= 7200) updateSettings({ recordSaveSeconds: Math.round(n) });
            }}
          />
          <span className="muted">seconds</span>
        </div>
      )}
    </div>
  );
}

function Capture() {
  const { settings, updateSettings } = useStore();
  return (
    <div className="set-group card">
      <SettingRow title="Rolling buffer" desc="Keeps recent seconds of every stream you watch, so Clip captures what just happened. Turn it off to save memory; clipping is then unavailable.">
        <Switch label="Rolling buffer" checked={settings.rollingBuffer} onChange={(rollingBuffer) => updateSettings({ rollingBuffer })} />
      </SettingRow>
      <SettingRow title="Clip length" desc="How far back a clip reaches. Changing it restarts the buffer.">
        <Seg<S["captureSeconds"]>
          label="Clip length"
          value={settings.captureSeconds}
          onChange={(captureSeconds) => updateSettings({ captureSeconds })}
          options={[15, 30, 60, 120].map((v) => ({ value: v as S["captureSeconds"], label: `${v}s` }))}
        />
      </SettingRow>
      <SettingRow title="Hassle-free recording" desc="Record every stream in real time from the moment it opens. The recorder shares the video capture with the rolling buffer. Turn it off to stop recording; the current segment is still saved.">
        <Switch label="Hassle-free recording" checked={settings.autoRecord} onChange={(autoRecord) => updateSettings({ autoRecord })} />
      </SettingRow>
      <SettingRow title="Auto-save recording every" desc="Pick a preset or set any interval from 30 seconds to 2 hours. Each save closes one clip and starts a fresh recording.">
        <RecordInterval />
      </SettingRow>
      <SettingRow title="Recording quality" desc="Full HD raises the bitrate and lets HLS use a 1080p rendition. Smooth keeps the lower bitrate and caps HLS to a small rendition when several streams run at once.">
        <Seg<S["recordQuality"]>
          label="Recording quality"
          value={settings.recordQuality}
          onChange={(recordQuality) => updateSettings({ recordQuality })}
          options={[
            { value: "fullhd", label: "Full HD" },
            { value: "smooth", label: "Smooth" },
          ]}
        />
      </SettingRow>
      <SettingRow title="Simultaneous streams" desc="How many streams can be watched and clipped at the same time. AI-assisted workflows support up to 4.">
        <Seg<S["maxStreams"]>
          label="Simultaneous streams"
          value={settings.maxStreams}
          onChange={(maxStreams) => updateSettings({ maxStreams })}
          options={[2, 3, 4].map((v) => ({ value: v as S["maxStreams"], label: String(v) }))}
        />
      </SettingRow>
      <SettingRow title="Auto-caption added clips" desc="For uploaded videos and manual or AI clips in Clips: transcribe on the GPU and attach word-level captions. Continuous recordings in Records stay uncaptioned.">
        <Switch label="Auto-caption added clips" checked={settings.autoCaptionOnClip} onChange={(autoCaptionOnClip) => updateSettings({ autoCaptionOnClip })} />
      </SettingRow>
      <SettingRow title="After a clip" desc="What happens when you press Clip on one stream.">
        <Seg<S["afterClip"]>
          label="After a clip"
          value={settings.afterClip}
          onChange={(afterClip) => updateSettings({ afterClip })}
          options={[
            { value: "stay", label: "Keep watching" },
            { value: "edit", label: "Open the Editor" },
          ]}
        />
      </SettingRow>
    </div>
  );
}

function EditorDefaults() {
  const { settings, updateSettings, templates } = useStore();
  return (
    <>
      <p className="set-note">These apply to the next project you open. A default template overrides the layout, caption and overlay choices.</p>
      <div className="set-group card">
        <SettingRow title="Default template" desc="Applied to every new clip you open.">
          <select className="select" value={settings.defaultTemplateId ?? ""} onChange={(e) => updateSettings({ defaultTemplateId: e.target.value || null })} aria-label="Default template">
            <option value="">None</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow title="Layout" desc="How footage fills the 9:16 frame.">
          <Seg
            label="Default layout"
            value={settings.defaultLayout}
            onChange={(defaultLayout) => updateSettings({ defaultLayout })}
            options={[
              { value: "fill", label: "Fill" },
              { value: "fit", label: "Fit" },
              { value: "split", label: "Facecam" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Auto 9:16 Fit in Editor" desc="Open every clip with the vertical 9:16 frame and Fit layout already applied, zoom reset to 1×.">
          <Switch label="Auto 9:16 Fit in Editor" checked={settings.autoFitOnOpen} onChange={(autoFitOnOpen) => updateSettings({ autoFitOnOpen })} />
        </SettingRow>
        <SettingRow title="Auto face + game detection" desc="When the Editor opens a clip, detect the facecam automatically and switch to the split layout — game on top, facecam below. Needs OpenCV Python or a Gemini key; Frame → Detect with AI retries manually.">
          <Switch label="Auto face + game detection" checked={settings.autoFacecamOnOpen} onChange={(autoFacecamOnOpen) => updateSettings({ autoFacecamOnOpen })} />
        </SettingRow>
        <SettingRow title="Caption font">
          <Seg
            label="Default caption font"
            value={settings.defaultCaptionFont}
            onChange={(defaultCaptionFont) => updateSettings({ defaultCaptionFont })}
            options={[
              { value: "bebas", label: "Bebas" },
              { value: "tiktok", label: "TikTok Sans" },
              { value: "inter", label: "Inter" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Social overlay">
          <Seg
            label="Default overlay"
            value={settings.defaultOverlay}
            onChange={(defaultOverlay) => updateSettings({ defaultOverlay })}
            options={[
              { value: "off", label: "Off" },
              { value: "tiktok", label: "TikTok" },
              { value: "shorts", label: "Shorts" },
              { value: "reels", label: "Reels" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Phone preview" desc="The frame drawn around the Editor's preview.">
          <Seg label="Phone" value={settings.phone} onChange={(phone) => updateSettings({ phone })} options={[{ value: "iphone", label: "iPhone" }, { value: "android", label: "Android" }]} />
        </SettingRow>
      </div>
    </>
  );
}

function AiSettings({ health }: { health: ServerHealth | null }) {
  const { settings, updateSettings, toast } = useStore();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<SpeechModel[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelLog, setModelLog] = useState("");
  const [modelProgress, setModelProgress] = useState(0);
  const [feedback, setFeedback] = useState(() => loadFeedbackStats());
  const [secretsStatus, setSecretsStatus] = useState<SecretsStatus | null>(null);
  const [vaultKeyInput, setVaultKeyInput] = useState<Record<"gemini" | "openai" | "kilo" | "cloud", string>>({
    gemini: "",
    openai: "",
    kilo: "",
    cloud: "",
  });
  const [vaultBusy, setVaultBusy] = useState(false);

  const refreshModels = async () => {
    try { setModels(await listSpeechModels()); } catch { /* local server may be starting */ }
  };
  const refreshSecrets = async () => {
    try { setSecretsStatus(await fetchSecretsStatus()); } catch { /* ignore when offline */ }
  };
  useEffect(() => {
    void refreshModels();
    void refreshSecrets();
  }, []);

  const saveVaultKey = async (provider: "gemini" | "openai" | "kilo" | "cloud", value: string) => {
    setVaultBusy(true);
    try {
      const next = await saveWorkspaceSecrets({ [provider]: value });
      setSecretsStatus(next);
      setVaultKeyInput((prev) => ({ ...prev, [provider]: "" }));
      toast(value ? `Saved encrypted ${provider} key to server vault.` : `Cleared ${provider} key from server vault.`, "success");
    } catch (e) {
      toast((e as Error).message || "Could not update encrypted vault.", "error");
    } finally {
      setVaultBusy(false);
    }
  };

  const downloadModel = async (id: string) => {
    setModelBusy(true);
    setModelLog("Starting download…");
    setModelProgress(0);
    try {
      await installSpeechModel(id, (s) => {
        if (s.log) setModelLog(s.log.split("\n").slice(-3).join(" "));
        setModelProgress(Math.max(0, Math.min(100, Number(s.progress) || 0)));
      });
      updateSettings({ captionModel: id as S["captionModel"] });
      await refreshModels();
      toast("Model downloaded and selected.", "success");
    } catch (e) {
      toast((e as Error).message || "Model download failed.", "error");
    } finally {
      setModelBusy(false);
      setModelLog("");
      setModelProgress(0);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const out = await chatCompletion(
        settings,
        [
          { role: "system", content: "Reply with valid JSON only." },
          { role: "user", content: 'Return {"ok":true,"message":"connected"}' },
        ],
        { json: true },
      );
      const parsed: any = tryParseJson(out);
      const ok = parsed?.ok === true || /connect|ok/i.test(out);
      const text = ok ? `Connected. Model replied: ${String(parsed?.message || "ok")}` : `Connected, but unexpected reply: ${out.slice(0, 120)}`;
      setTestMsg({ ok, text });
      toast(ok ? "Endpoint is working." : "Endpoint replied, but response was unexpected.", ok ? "success" : "info");
    } catch (e) {
      const raw = (e as Error).message || "Connection failed.";
      const overloaded = /high demand|overloaded|429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|temporarily/i.test(raw);
      const text = overloaded ? `${raw} Try a different model above.` : raw;
      setTestMsg({ ok: false, text });
      toast(text, "error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      {health && (
        <div className="cap-badges" aria-label="Server capabilities">
          <span className={`chip ${health.ffmpeg ? "success" : "danger"}`}>
            FFmpeg {health.ffmpeg ? (health.nvenc ? "· NVENC" : "· CPU") : "missing"}
          </span>
          <span className={`chip ${health.gemini || secretsStatus?.gemini ? "success" : ""}`}>
            Gemini {health.gemini || secretsStatus?.gemini ? "key ready" : "optional"}
          </span>
          <span className={`chip ${health.scenedetect ? "success" : ""}`}>
            Scenes {health.sceneBackend === "pyscenedetect" ? "· PySceneDetect" : health.sceneBackend === "ffmpeg" ? "· FFmpeg" : "unavailable"}
          </span>
          <span className={`chip ${health.streamlink ? "success" : ""}`}>
            Streamlink {health.streamlink ? "ready" : "optional"}
          </span>
          <span className={`chip ${health.opencv ? "success" : ""}`}>
            OpenCV {health.opencv ? "ready" : "YuNet / Gemini fallback"}
          </span>
          <span className={`chip ${health.audiocpp || health.nemo ? "success" : ""}`}>
            Speech {health.audiocpp ? "· audio.cpp" : health.nemo ? "· NeMo" : "· Gemini fallback"}
          </span>
        </div>
      )}

      <div className="set-group card">
        <SettingRow
          title="Local-Only Privacy Mode"
          desc="Blocks cloud AI calls (Gemini / OpenAI / remote URLs) and enforces localhost-only inference (local Ollama + on-device audio.cpp / YuNet)."
        >
          <div className="row">
            <Switch
              label="Local-Only Privacy Mode"
              checked={settings.localOnlyMode}
              onChange={(localOnlyMode) => {
                updateSettings({
                  localOnlyMode,
                  ...(localOnlyMode && settings.aiProfile !== "local" ? { aiProfile: "local" as const } : {}),
                });
                toast(localOnlyMode ? "Local-Only Privacy Mode enabled" : "Cloud AI endpoints permitted", "info");
              }}
            />
            {settings.localOnlyMode && <span className="chip success"><ShieldCheck className="ic" /> On-device only</span>}
          </div>
        </SettingRow>
        <SettingRow wide title="Endpoint" desc="Where AI requests go: Google AI Studio (Gemini) on the server, or any OpenAI-compatible AI (OpenAI, 9Router, OpenRouter, Groq, Together, Google Colab MiMo, Local Ollama).">
          <div className="ai-stack">
            <Seg<"gemini" | "openai" | "cloud" | "local" | "kilo">
              label="AI endpoint"
              value={settings.aiProfile}
              onChange={(aiProfile) => { updateSettings({ aiProfile }); setTestMsg(null); }}
              options={[
                { value: "gemini", label: "AI Studio (Gemini)" },
                { value: "openai", label: "OpenAI / Custom" },
                { value: "kilo", label: "9Router" },
                { value: "cloud", label: "Cloud (Colab)" },
                { value: "local", label: "Local Ollama" },
              ]}
            />
            {(() => {
              const profile = settings.aiProfile;
              const p = profile === "cloud" ? settings.aiCloud
                : profile === "gemini" ? settings.aiGemini
                  : profile === "openai" ? settings.aiOpenAi
                    : profile === "kilo" ? settings.aiKilo
                      : settings.aiLocal;
              const set = (patch: Partial<typeof p>) => {
                updateSettings(
                  profile === "cloud" ? { aiCloud: { ...settings.aiCloud, ...patch } }
                    : profile === "gemini" ? { aiGemini: { ...settings.aiGemini, ...patch } }
                      : profile === "openai" ? { aiOpenAi: { ...settings.aiOpenAi, ...patch } }
                        : profile === "kilo" ? { aiKilo: { ...settings.aiKilo, ...patch } }
                          : { aiLocal: { ...settings.aiLocal, ...patch } },
                );
                setTestMsg(null);
              };
              return (
                <>
                  {profile === "gemini" ? (
                    <input
                      className="input"
                      type="password"
                      value={p.apiKey}
                      placeholder="AI Studio API key (optional when the server sets GEMINI_API_KEY)"
                      onChange={(e) => set({ apiKey: e.target.value })}
                      aria-label="Gemini API key"
                    />
                  ) : (
                    <>
                      <input className="input" value={p.baseUrl} placeholder={profile === "openai" ? "https://api.openai.com/v1" : profile === "kilo" ? "https://your-tunnel.example/v1" : profile === "cloud" ? "https://xxxx.trycloudflare.com/v1" : "http://localhost:11434/v1"} onChange={(e) => set({ baseUrl: e.target.value })} aria-label="AI base URL" />
                      <input className="input" type="password" value={p.apiKey} placeholder={profile === "openai" ? "sk-... API key for your provider" : profile === "kilo" ? "sk-... API key for 9Router" : "sk-... (leave empty for local Ollama)"} onChange={(e) => set({ apiKey: e.target.value })} aria-label="AI API key" />
                    </>
                  )}
                  <div className="ai-stack">
                    <input
                      className="input"
                      list={profile === "gemini" ? "gemini-model-options" : undefined}
                      value={p.model}
                      placeholder={profile === "gemini" ? "gemini-4-hydrogen (type any model name)" : profile === "openai" ? "gpt-4o-mini" : profile === "kilo" ? "kc/kilo-auto/free" : "mimo-v2.6-heretic"}
                      onChange={(e) => set({ model: e.target.value })}
                      aria-label="AI model"
                    />
                    {profile === "gemini" && (
                      <datalist id="gemini-model-options">
                        <option value="gemini-4-hydrogen">Recommended: multimodal audio + video + fast</option>
                        <option value="gemini-3.1-flash-lite">Ultra-fast lightweight</option>
                      </datalist>
                    )}
                    <div className="row test-row">
                      <button className="btn ghost sm" onClick={() => void testConnection()} disabled={testing}>
                        {testing ? <span className="spinner" /> : null} Test connection
                      </button>
                      {testMsg && <span className={`test-msg ${testMsg.ok ? "ok" : "err"}`}>{testMsg.text}</span>}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </SettingRow>
        <SettingRow title="AI auto clip finder" desc="While streams or captured tabs are open, Clipweave samples audio and video frames, detects energy spikes, scores viral potential with AI, and saves clips at or above your threshold.">
          <Switch label="AI auto clip finder" checked={settings.aiAutoClip} onChange={(aiAutoClip) => updateSettings({ aiAutoClip })} />
        </SettingRow>
        <SettingRow title="Check interval" desc="How often AI listens to each open stream. Audio energy spikes also trigger extra checks on cooldown.">
          <select
            className="select"
            value={settings.aiClipInterval}
            onChange={(e) => updateSettings({ aiClipInterval: Number(e.target.value) })}
            aria-label="AI check interval"
          >
            {Array.from({ length: 13 }, (_, i) => i + 3).map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow title="Clip threshold" desc="Minimum AI score (1-10) before a moment is saved to Clips. Higher = fewer, better clips.">
          <Seg<S["aiClipThreshold"]>
            label="AI clip threshold"
            value={settings.aiClipThreshold}
            onChange={(aiClipThreshold) => updateSettings({ aiClipThreshold })}
            options={[3, 5, 7, 8, 9].map((v) => ({ value: v as S["aiClipThreshold"], label: String(v) }))}
          />
        </SettingRow>
      </div>

      <details className="set-advanced set-group card">
        <summary>Advanced models, prompt &amp; calibration</summary>
        <SettingRow title="NeMo-Speech / caption service" desc="Optional external nemo-speech HTTP URL. Clipweave prefers its own audio.cpp runtime (installed automatically with the default model below), then local nemo-speech, and finally falls back to AI Studio Gemini for transcription & word-level captions.">
          <input className="input" value={settings.nemoSpeechUrl} placeholder="http://127.0.0.1:8081 (optional)" onChange={(e) => updateSettings({ nemoSpeechUrl: e.target.value })} aria-label="NeMo-Speech URL" />
        </SettingRow>
        <SettingRow title="Caption model" desc="Local speech model with word-level timestamps. Download & use provisions the audio.cpp runtime and the model into this machine — no other installs needed. Inside AI Studio, Gemini handles transcription automatically.">
          <div className="ai-stack">
            <select
              className="select"
              value={settings.captionModel}
              onChange={(e) => updateSettings({ captionModel: e.target.value as S["captionModel"] })}
              aria-label="Caption model"
            >
              {models.length === 0 && <option value={settings.captionModel}>{settings.captionModel}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.installed ? ` ✓${m.backend ? ` (${m.backend})` : ""}` : ` · download (${m.size})`}
                </option>
              ))}
            </select>
            <div className="row">
              <button
                className="btn ghost sm"
                disabled={modelBusy || !models.find((m) => m.id === settings.captionModel && !m.installed)}
                onClick={() => void downloadModel(settings.captionModel)}
              >
                {modelBusy ? <span className="spinner" /> : <Download className="ic" />}
                {modelBusy ? "Downloading…" : "Download & use"}
              </button>
              <button className="btn plain sm" onClick={() => void refreshModels()} disabled={modelBusy}>Refresh</button>
            </div>
            {modelBusy && modelProgress > 0 && (
              <progress value={modelProgress} max={100} aria-label="Caption model download progress" />
            )}
            {modelLog && <small className="muted model-log" role="status" aria-live="polite">{modelLog}</small>}
          </div>
        </SettingRow>
        <SettingRow wide title="AI clip-finding instructions" desc="Prompt used when asking AI to find the best viral moments from audio/video/transcripts.">
          <AutoTextarea value={settings.aiClipPrompt} onChange={(aiClipPrompt) => updateSettings({ aiClipPrompt })} label="AI clip prompt" />
        </SettingRow>
        <SettingRow
          title="Creator feedback calibration"
          desc={
            feedback.total > 0
              ? `${feedback.total} signals saved (${feedback.favourites + feedback.edited + feedback.rendered} kept · ${feedback.dismissed} dismissed). Used automatically to tune future AI clip picks.`
              : "Clips you favourite, edit, render, or dismiss teach the AI your taste over time."
          }
        >
          <button
            className="btn ghost sm"
            disabled={feedback.total === 0}
            onClick={() => {
              setFeedback(resetFeedbackStats());
              toast("AI calibration history cleared.", "info");
            }}
          >
            Reset calibration
          </button>
        </SettingRow>
      </details>

      <div className="set-group card">
        <SettingRow
          title="Encrypted Server Secret Vault"
          desc="Store AI API keys encrypted on your machine (AES-256-GCM with 0600 key permissions) instead of browser localStorage. Keys are write-only and never displayed again."
          wide
        >
          <div className="vault-grid">
            {(["gemini", "openai", "kilo", "cloud"] as const).map((provider) => {
              const configured = Boolean(secretsStatus?.[provider]);
              const val = vaultKeyInput[provider];
              return (
                <div key={provider} className="vault-row">
                  <div className="row">
                    <KeyRound className="ic" />
                    <b style={{ textTransform: "capitalize" }}>{provider === "kilo" ? "9Router" : provider}</b>
                    <span className={`chip ${configured ? "success" : ""}`}>{configured ? "Configured" : "Not set"}</span>
                  </div>
                  <div className="row">
                    <input
                      className="input"
                      type="password"
                      value={val}
                      placeholder={configured ? "Enter new key to replace…" : `Paste ${provider} key…`}
                      aria-label={`${provider} server vault key`}
                      onChange={(e) => setVaultKeyInput((prev) => ({ ...prev, [provider]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={vaultBusy || !val.trim()}
                      onClick={() => void saveVaultKey(provider, val.trim())}
                    >
                      Save key
                    </button>
                    {configured && (
                      <button
                        type="button"
                        className="btn plain sm"
                        disabled={vaultBusy}
                        onClick={() => void saveVaultKey(provider, "")}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SettingRow>
      </div>
    </>
  );
}

function Export({ health }: { health: ServerHealth | null }) {
  const { settings, updateSettings, toast } = useStore();
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => { void getRenderFolder().then((d) => setFolder(d?.name || null)); }, []);
  const chooseFolder = async () => {
    try {
      const name = await pickRenderFolder();
      if (name) {
        setFolder(name);
        updateSettings({ autoDownloadRenders: true });
        toast(`Renders will be saved to ${name}`, "success");
      }
    } catch {
      toast("Folder selection was cancelled.", "info");
    }
  };
  return (
    <div className="set-group card">
      <SettingRow title="Resolution" desc="Vertical 9:16. 1080p takes more memory while rendering.">
        <Seg<S["exportHeight"]>
          label="Resolution"
          value={settings.exportHeight}
          onChange={(exportHeight) => updateSettings({ exportHeight })}
          options={[
            { value: 720, label: "720×1280" },
            { value: 1080, label: "1080×1920" },
          ]}
        />
      </SettingRow>
      <SettingRow title="Format" desc="MP4 is default with native FFmpeg. WebM is smaller and natively supported in-browser.">
        <Seg<S["exportFormat"]>
          label="Format"
          value={settings.exportFormat}
          onChange={(exportFormat) => updateSettings({ exportFormat })}
          options={[{ value: "webm", label: "WebM" }, { value: "mp4", label: "MP4" }]}
        />
      </SettingRow>
      <SettingRow title="File name" desc={`Use {title}, {date} and {time}. Next file: “${fileNameFor(settings.fileNamePattern, "Highlight Clip")}”`}>
        <input className="input" value={settings.fileNamePattern} maxLength={80} onChange={(e) => updateSettings({ fileNamePattern: e.target.value })} aria-label="File name pattern" />
      </SettingRow>
      <SettingRow
        title="Active renderer"
        desc={
          health?.ffmpeg
            ? "Fast server-side FFmpeg encoding runs automatically with burned captions and zero tab-focus requirement. Falls back to browser capture if offline."
            : "Server FFmpeg not detected; rendering runs in this tab with MediaRecorder while it stays visible."
        }
      >
        <span className={`chip ${health?.ffmpeg ? "success" : ""}`}>
          {health?.ffmpeg ? `Native FFmpeg (${health.nvenc ? "GPU NVENC" : "CPU"})` : "Browser capture"}
        </span>
      </SettingRow>
      <SettingRow title="Name before rendering" desc="Ask for a name each time you press Render.">
        <Switch label="Name before rendering" checked={settings.nameBeforeRender} onChange={(nameBeforeRender) => updateSettings({ nameBeforeRender })} />
      </SettingRow>
      <SettingRow
        title="Save exports to Workspace Exports folder"
        desc="Automatically writes a permanent copy of every native FFmpeg export into your Workspace Exports/ folder."
      >
        <Switch
          label="Save exports to Workspace Exports folder"
          checked={settings.autoSaveExports}
          onChange={(autoSaveExports) => {
            updateSettings({ autoSaveExports });
            void saveWorkspaceConfig({ autoSaveExports }).catch(() => {});
          }}
        />
      </SettingRow>
      <SettingRow
        title="Auto-download finished renders"
        desc={canPickFolder()
          ? `Downloads each finished video to this device as soon as it renders${folder ? `, into ${folder}` : " (your browser's Downloads folder)"}. Choose a folder to send them somewhere specific. Browsers may ask to allow automatic downloads the first time.`
          : "Downloads each finished video to this device as soon as it renders. Browsers may ask to allow automatic downloads the first time."}
      >
        <div className="row export-folder-row">
          <Switch label="Auto-download finished renders" checked={settings.autoDownloadRenders} onChange={(autoDownloadRenders) => updateSettings({ autoDownloadRenders })} />
          {canPickFolder() && (
            <>
              <button className="btn ghost sm" onClick={() => void chooseFolder()}>{folder ? "Change folder" : "Choose folder"}</button>
              {folder && <button className="btn plain sm" onClick={() => { void clearRenderFolder(); setFolder(null); }}>Clear</button>}
            </>
          )}
        </div>
      </SettingRow>
    </div>
  );
}

function Data() {
  const { templates, updateSettings, toast, savedProjects } = useStore();
  const { clips } = useLibrary();
  const { jobs } = useQueue();
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [serverCache, setServerCache] = useState<{ bytes: number; entries: number } | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [savingDir, setSavingDir] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const refreshServerCache = useCallback(() => {
    apiJson<{ bytes: number; entries?: number }>("/api/cache")
      .then((c) => {
        if (c && typeof c.bytes === "number") setServerCache({ bytes: c.bytes, entries: c.entries ?? 0 });
      })
      .catch(() => {});
  }, []);

  const refreshWorkspace = useCallback(() => {
    fetchWorkspaceConfig()
      .then((w) => {
        setWorkspace(w);
        setWorkspaceInput(w.workspaceDir);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }));
    refreshServerCache();
    refreshWorkspace();
  }, [clips.length, jobs.length, refreshServerCache, refreshWorkspace]);

  const applyWorkspaceDir = async (dir: string) => {
    if (!dir.trim()) return;
    setSavingDir(true);
    try {
      const updated = await saveWorkspaceConfig({ workspaceDir: dir.trim() });
      setWorkspace(updated);
      setWorkspaceInput(updated.workspaceDir);
      toast(`Workspace folder updated to ${updated.workspaceDir}`, "success");
    } catch (e) {
      toast((e as Error).message || "Could not update workspace folder.", "error");
    } finally {
      setSavingDir(false);
    }
  };

  const browseFolder = async () => {
    const picked = await chooseWorkspaceDirectory();
    if (picked) await applyWorkspaceDir(picked);
  };

  const pruneServer = async () => {
    setPruning(true);
    try {
      const c = await apiPostJson<{ removed?: number; bytes?: number; entries?: number }>("/api/cache/prune", {});
      setServerCache({ bytes: c.bytes ?? 0, entries: c.entries ?? 0 });
      toast(`Cleared server temp cache (${c.removed ?? 0} entries removed).`, "success");
    } catch (e) {
      toast((e as Error).message || "Could not prune server cache.", "error");
    } finally {
      setPruning(false);
    }
  };

  const wipe = async () => {
    await clearBlobs();
    Object.keys(localStorage)
      .filter((k) => k.startsWith("clipkit."))
      .forEach((k) => localStorage.removeItem(k));
    location.reload();
  };

  const usagePct = usage && usage.quota > 0 ? Math.min(100, (usage.used / usage.quota) * 100) : 0;

  return (
    <>
      <div className="set-group card">
        <SettingRow
          wide
          title="ClipWeave Workspace Folder"
          desc="Stores persistent Projects, Recordings, Clips, Exports, and imported Media files on disk."
        >
          <div className="ai-stack">
            <div className="row" style={{ width: "100%", flexWrap: "wrap" }}>
              <input
                className="input grow"
                value={workspaceInput}
                onChange={(e) => setWorkspaceInput(e.target.value)}
                aria-label="Workspace directory"
                placeholder="Workspace directory path"
              />
              <button
                type="button"
                className="btn ghost sm"
                disabled={savingDir}
                onClick={() => void applyWorkspaceDir(workspaceInput)}
              >
                {savingDir ? "Saving…" : "Apply path"}
              </button>
              <button
                type="button"
                className="btn plain sm"
                disabled={savingDir}
                onClick={() => void browseFolder()}
                title="Choose folder in desktop app"
              >
                <FolderOpen className="ic" /> Browse
              </button>
            </div>
            {workspace && (
              <div className="workspace-meta">
                <small className="muted">
                  Folders: <code>Projects/</code> · <code>Recordings/</code> · <code>Exports/</code> · <code>Media/</code>
                  {workspace.disk ? ` — ${fmtBytes(workspace.disk.freeBytes)} free of ${fmtBytes(workspace.disk.totalBytes)}` : ""}
                </small>
                <small className="muted">App data directory: <code>{workspace.dataDir}</code></small>
              </div>
            )}
          </div>
        </SettingRow>
        <SettingRow title="Browser space used" desc="Clips, imported files and renders are kept in this browser's IndexedDB storage on this device.">
          <div className="usage">
            <b className="tabular">{usage ? fmtBytes(usage.used) : "–"}</b>
            {usage && usage.quota > 0 && (
              <span className="usage-bar">
                <progress value={usagePct} max={100} aria-label="Browser storage used" />
              </span>
            )}
          </div>
        </SettingRow>
        <SettingRow title="Server temp cache" desc="Temporary media, render outputs, and stream remux files cached by the local backend (auto-pruned after 30 min idle).">
          <div className="row cache-ctl">
            <span className="muted tabular">{serverCache ? `${fmtBytes(serverCache.bytes)} · ${serverCache.entries} entries` : "–"}</span>
            <button className="btn ghost sm" onClick={() => void pruneServer()} disabled={pruning || (serverCache?.entries ?? 0) === 0}>
              {pruning ? <span className="spinner" /> : null} Prune cache
            </button>
          </div>
        </SettingRow>
        <SettingRow title="Saved" desc="Removed clips still take space until you delete them for good.">
          <span className="muted tabular">
            {clips.length} clips · {savedProjects.length} projects · {jobs.filter((j) => j.status === "done").length} renders · {templates.length} templates
          </span>
        </SettingRow>
        <SettingRow title="Show first-run wizard again">
          <button className="btn ghost sm" onClick={() => updateSettings({ setupDone: false })}>
            Open wizard
          </button>
        </SettingRow>
        <SettingRow title="Erase browser data" desc="Deletes clips, renders, templates, streams and settings cached in this browser.">
          <button className="btn danger sm" onClick={() => setConfirm(true)}>
            Erase
          </button>
        </SettingRow>
      </div>
      {confirm && (
        <Modal
          title="Erase everything?"
          description="Clips and renders that you haven't saved to your Workspace Exports folder are gone for good."
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn danger" onClick={wipe}>Erase everything</button>
            </>
          }
        >
          <Field label="This can't be undone.">
            <span className="muted">The page reloads afterwards.</span>
          </Field>
        </Modal>
      )}
    </>
  );
}

function DiagnosticsPanel() {
  const { updateSettings, toast } = useStore();
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchDiagnostics()
      .then((r) => setReport(r))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const exportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    downloadBlob(blob, `clipweave-diagnostics-${new Date().toISOString().slice(0, 10)}.json`);
    toast("Redacted diagnostics report downloaded.", "success");
  };

  return (
    <>
      <h2 className="sec-title">Diagnostics &amp; updates</h2>
      <div className="set-group card">
        <SettingRow title="Application version" desc={report?.logFile ? `Structured rotating log: ${report.logFile}` : "ClipWeave desktop & web studio"}>
          <div className="row">
            <span className="chip">{report?.appVersion ? `v${report.appVersion}` : "Checking…"}</span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => openExternalUrl("https://github.com/mushfiqk47/uoyi/releases")}
            >
              <ExternalLink className="ic" /> Check releases
            </button>
          </div>
        </SettingRow>
        <SettingRow title="Troubleshooting tools" desc="Download a redacted diagnostic report (API keys & tokens stripped) or re-run the system check wizard.">
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn accent sm" disabled={!report} onClick={exportJson}>
              <Download className="ic" /> Download report
            </button>
            <button type="button" className="btn ghost sm" onClick={() => updateSettings({ setupDone: false })}>
              Re-open wizard
            </button>
            <button type="button" className="btn plain sm" disabled={loading} onClick={load}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </SettingRow>
        <SettingRow wide title="Recent redacted runtime logs" desc="Helpful when reporting a bug or checking FFmpeg / stream capture behavior.">
          <pre className="diag-logs">
            {report?.logs?.length ? report.logs.slice(-60).join("\n") : loading ? "Loading diagnostics…" : "No recent logs recorded."}
          </pre>
        </SettingRow>
      </div>
    </>
  );
}
