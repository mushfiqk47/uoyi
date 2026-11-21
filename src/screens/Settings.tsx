import { useEffect, useState } from "react";
import { Check, HardDrive, Palette, Scissors, Clapperboard, Download, Sparkles } from "lucide-react";
import { useLibrary, useQueue, useStore } from "../store";
import { chatCompletion, tryParseJson } from "../lib/ai/openai";
import { listSpeechModels, downloadSpeechModel, speechModelStatus, type SpeechModel } from "../platform/api/models";
import { ACCENTS, BACKGROUNDS, THEMES, type ButtonStyle, type Settings as S } from "../lib/settings";
import { AutoTextarea, Field, Modal, Seg, Switch } from "../components/ui";
import { clearBlobs } from "../lib/db";
import { fileNameFor } from "../lib/project";
import { fmtBytes } from "../lib/util";
import { canPickFolder, clearRenderFolder, getRenderFolder, pickRenderFolder } from "../lib/renderFolder";

type Section = "appearance" | "capture" | "editor" | "ai" | "export" | "data";

const SECTIONS: { id: Section; label: string; Icon: typeof Palette }[] = [
  { id: "appearance", label: "Themes", Icon: Palette },
  { id: "capture", label: "Clipping", Icon: Scissors },
  { id: "editor", label: "Editor", Icon: Clapperboard },
  { id: "ai", label: "AI", Icon: Sparkles },
  { id: "export", label: "Rendering", Icon: Download },
  { id: "data", label: "Storage", Icon: HardDrive },
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
  const [section, setSection] = useState<Section>("appearance");
  return (
    <main className="page settings">
      <div className="pagehead">
        <div>
          <h1>Settings</h1>
          <p>Saved in this browser and used straight away.</p>
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
          {section === "appearance" && <Appearance />}
          {section === "capture" && <Capture />}
          {section === "editor" && <EditorDefaults />}
          {section === "ai" && <AiSettings />}
          {section === "export" && <Export />}
          {section === "data" && <Data />}
        </div>
      </div>
    </main>
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

function AiSettings() {
  const { settings, updateSettings, toast } = useStore();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<SpeechModel[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelLog, setModelLog] = useState("");

  const refreshModels = async () => {
    try { setModels(await listSpeechModels()); } catch { /* local server may be starting */ }
  };
  useEffect(() => { void refreshModels(); }, []);

  const downloadModel = async (id: string) => {
    setModelBusy(true);
    setModelLog("Starting download…");
    try {
      const job = await downloadSpeechModel(id);
      for (let i = 0; i < 1800; i++) {
        const s = await speechModelStatus(job.id || id);
        if (s.log) setModelLog(s.log.split("\n").slice(-3).join(" "));
        if (s.status === "ready") break;
        if (s.status === "failed") throw new Error(s.log || "Download failed");
        await new Promise((r) => setTimeout(r, 1000));
      }
      updateSettings({ captionModel: id as S["captionModel"] });
      await refreshModels();
      toast("Model downloaded and selected.", "success");
    } catch (e) {
      toast((e as Error).message || "Model download failed.", "error");
    } finally {
      setModelBusy(false);
      setModelLog("");
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
    <div className="set-group card">
      <SettingRow wide title="Endpoint" desc="Where AI requests go: Google AI Studio (Gemini) on the server, or any OpenAI-compatible AI (OpenAI, Kilo Gateway, OpenRouter, Groq, Together, Google Colab MiMo, Local Ollama).">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Seg<"gemini" | "openai" | "cloud" | "local" | "kilo">
            label="AI endpoint"
            value={settings.aiProfile}
            onChange={(aiProfile) => { updateSettings({ aiProfile }); setTestMsg(null); }}
            options={[
              { value: "gemini", label: "AI Studio (Gemini)" },
              { value: "openai", label: "OpenAI / Custom" },
              { value: "kilo", label: "Kilo Gateway" },
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
                    <input className="input" value={p.baseUrl} placeholder={profile === "openai" ? "https://api.openai.com/v1" : profile === "kilo" ? "https://rjvi38q.abc-tunnel.us/v1" : profile === "cloud" ? "https://xxxx.trycloudflare.com/v1" : "http://localhost:11434/v1"} onChange={(e) => set({ baseUrl: e.target.value })} aria-label="AI base URL" />
                    <input className="input" type="password" value={p.apiKey} placeholder={profile === "openai" ? "sk-... API key for your provider" : profile === "kilo" ? "sk-... API key for Kilo Gateway" : "sk-... (leave empty for local Ollama)"} onChange={(e) => set({ apiKey: e.target.value })} aria-label="AI API key" />
                  </>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 280 }}>
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
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <button className="btn ghost sm" onClick={() => void testConnection()} disabled={testing}>
                      {testing ? <span className="spinner" /> : null} Test connection
                    </button>
                    {testMsg && <span style={{ fontSize: 12, color: testMsg.ok ? "var(--success)" : "var(--live)" }}>{testMsg.text}</span>}
                  </div>
                  {settings.aiProfile === "cloud" && (
                    <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                      Run <code>mimo_v26_heretic_ollama_colab.ipynb</code> on a T4 runtime with <b>Run all</b>, then paste the printed Base URL and API key here. The tunnel URL and key change every time the notebook re-runs (unless you pin <code>API_KEY</code> in the Config cell).
                    </p>
                  )}
                  {settings.aiProfile === "gemini" && (
                    <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                      Paste a Google AI Studio API key above, or leave it empty to use the server's <code>GEMINI_API_KEY</code> secret. The key powers AI chat, viral clip scoring, titles and live judging.
                    </p>
                  )}
                  {settings.aiProfile === "kilo" && (
                    <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                      Preconfigured OpenAI-compatible Kilo Gateway route with the <code>kc/kilo-auto/free</code> model. Paste your API key above (saved locally in settings), then press Test connection. The base URL and model are editable.
                    </p>
                  )}
                  {settings.aiProfile === "openai" && (
                    <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                      Any provider that speaks the OpenAI chat-completions API works here: OpenAI, OpenRouter, Groq, Together, LM Studio, vLLM, or your own gateway. Enter its base URL (ending in <code>/v1</code>), your key and a model name, then press Test connection.
                    </p>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </SettingRow>
      <SettingRow title="NeMo-Speech / caption service" desc="Optional external nemo-speech HTTP URL. When empty, Clipweave uses local nemo-speech if installed or automatically falls back to AI Studio Gemini for transcription & word-level captions.">
        <input className="input" value={settings.nemoSpeechUrl} placeholder="http://127.0.0.1:8081 (optional)" onChange={(e) => updateSettings({ nemoSpeechUrl: e.target.value })} aria-label="NeMo-Speech URL" />
      </SettingRow>
      <SettingRow title="Caption model" desc="Local NeMo speech model (when running locally with nemo-speech). Inside AI Studio, Gemini handles transcription and captions automatically.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 280 }}>
          <select
            className="select"
            value={settings.captionModel}
            onChange={(e) => updateSettings({ captionModel: e.target.value as S["captionModel"] })}
            aria-label="Caption model"
          >
            {models.length === 0 && <option value={settings.captionModel}>{settings.captionModel}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}{m.installed ? " ✓" : ` · download (${m.size})`}
              </option>
            ))}
          </select>
          <div className="row" style={{ gap: 8 }}>
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
          {modelLog && <small className="muted" role="status" aria-live="polite" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{modelLog}</small>}
        </div>
      </SettingRow>
      <SettingRow wide title="AI clip-finding instructions" desc="Prompt used when asking AI to find the best viral moments from audio/video/transcripts.">
        <AutoTextarea value={settings.aiClipPrompt} onChange={(aiClipPrompt) => updateSettings({ aiClipPrompt })} label="AI clip prompt" />
      </SettingRow>
      <SettingRow title="AI auto clip finder" desc="While streams or captured tabs are open, Clipweave samples audio and video frames, scores viral potential with AI, and saves clips at or above your threshold.">
        <Switch label="AI auto clip finder" checked={settings.aiAutoClip} onChange={(aiAutoClip) => updateSettings({ aiAutoClip })} />
      </SettingRow>
      <SettingRow title="Check interval" desc="How often AI listens to each open stream. More often catches more moments but uses more GPU/AI calls.">
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
  );
}

function Export() {
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
      <SettingRow title="Frame rate" desc="Frames are drawn and recorded in this tab. Recording runs in real time, so rates above your screen's refresh rate won't add real frames.">
        <Seg<S["exportFps"]> label="Frame rate" value={settings.exportFps} onChange={(exportFps) => updateSettings({ exportFps })} options={[{ value: 30, label: "30 fps" }, { value: 60, label: "60 fps" }, { value: 90, label: "90 fps" }]} />
      </SettingRow>
      <SettingRow title="Format" desc="MP4 if this browser can record it, WebM otherwise. WebM is smaller.">
        <Seg<S["exportFormat"]>
          label="Format"
          value={settings.exportFormat}
          onChange={(exportFormat) => updateSettings({ exportFormat })}
          options={[{ value: "webm", label: "WebM" }, { value: "mp4", label: "MP4" }]}
        />
      </SettingRow>
      <SettingRow title="File name" desc={`Use {title}, {date} and {time}. Next file: “${fileNameFor(settings.fileNamePattern, "Big Buck Bunny")}”`}>
        <input className="input" value={settings.fileNamePattern} maxLength={80} onChange={(e) => updateSettings({ fileNamePattern: e.target.value })} aria-label="File name pattern" />
      </SettingRow>
      <SettingRow title="Browser render (real time)" desc="Rendering happens in this tab with the browser's MediaRecorder while the timeline plays once. Keep the tab open and in front until jobs finish.">
        <span className="muted" style={{ fontSize: 12.5 }}>Enabled</span>
      </SettingRow>
      <SettingRow title="Name before rendering" desc="Ask for a name each time you press Render.">
        <Switch label="Name before rendering" checked={settings.nameBeforeRender} onChange={(nameBeforeRender) => updateSettings({ nameBeforeRender })} />
      </SettingRow>
      <SettingRow
        title="Auto-download finished renders"
        desc={canPickFolder()
          ? `Downloads each finished video to this device as soon as it renders${folder ? `, into ${folder}` : " (your browser's Downloads folder)"}. Choose a folder to send them somewhere specific. Browsers may ask to allow automatic downloads the first time.`
          : "Downloads each finished video to this device as soon as it renders. Browsers may ask to allow automatic downloads the first time."}
      >
        <div className="row" style={{ gap: 8 }}>
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
  const { templates, updateSettings } = useStore();
  const { clips } = useLibrary();
  const { jobs } = useQueue();
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }));
  }, [clips.length, jobs.length]);

  const wipe = async () => {
    await clearBlobs();
    Object.keys(localStorage)
      .filter((k) => k.startsWith("clipkit."))
      .forEach((k) => localStorage.removeItem(k));
    location.reload();
  };

  return (
    <>
      <div className="set-group card">
        <SettingRow title="Space used" desc="Clips, imported files and renders are kept in this browser's storage, on this device only.">
          <div className="usage">
            <b className="tabular">{usage ? fmtBytes(usage.used) : "–"}</b>
            {usage && usage.quota > 0 && (
              <span className="usage-bar">
                <i style={{ width: `${Math.min(100, (usage.used / usage.quota) * 100)}%` }} />
              </span>
            )}
          </div>
        </SettingRow>
        <SettingRow title="Saved" desc="Removed clips still take space until you delete them for good.">
          <span className="muted tabular">
            {clips.length} clips · {jobs.filter((j) => j.status === "done").length} renders · {templates.length} templates
          </span>
        </SettingRow>
        <SettingRow title="Show the introduction again">
          <button className="btn ghost sm" onClick={() => updateSettings({ setupDone: false })}>
            Show it
          </button>
        </SettingRow>
        <SettingRow title="Erase everything" desc="Deletes every clip, render, template, stream and setting from this browser.">
          <button className="btn danger sm" onClick={() => setConfirm(true)}>
            Erase
          </button>
        </SettingRow>
      </div>
      {confirm && (
        <Modal
          title="Erase everything?"
          description="Clips and renders that you haven't downloaded are gone for good."
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
