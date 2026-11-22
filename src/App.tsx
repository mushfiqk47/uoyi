import { lazy, Suspense, useEffect, useState } from "react";
import { StoreProvider, useShellStore } from "./store";
import { TopBar } from "./components/TopBar";
import { Toasts } from "./components/Toasts";
import { Onboarding } from "./components/Onboarding";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Viewer } from "./screens/Viewer";

const Clips = lazy(() => import("./screens/Clips").then((module) => ({ default: module.Clips })));
const Recommend = lazy(() => import("./screens/Recommend").then((module) => ({ default: module.Recommend })));
const Editor = lazy(() => import("./screens/Editor").then((module) => ({ default: module.Editor })));
const Queue = lazy(() => import("./screens/Queue").then((module) => ({ default: module.Queue })));
const Settings = lazy(() => import("./screens/Settings").then((module) => ({ default: module.Settings })));

function Shell() {
  const { screen, settings } = useShellStore();
  const autostart = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autostart") === "1";
  const [help, setHelp] = useState(!autostart && !settings.setupDone);
  useEffect(() => {
    if (!settings.setupDone && !autostart) setHelp(true);
  }, [settings.setupDone, autostart]);
  return (
    <div className="app">
      <TopBar onHelp={() => setHelp(true)} />
      {/* The Viewer stays mounted so streams keep recording in the background on other screens. */}
      <ErrorBoundary resetKey={screen}>
        <div className="screen-host" hidden={screen !== "viewer"}>
          <Viewer />
        </div>
      </ErrorBoundary>
      <ErrorBoundary resetKey={screen}>
        <Suspense fallback={<div className="screen-loading" role="status">Loading screen…</div>}>
          {screen === "recommend" && <Recommend key="recommend" />}
          {screen === "clips" && <Clips key="clips" />}
          {screen === "editor" && <Editor key="editor" />}
          {screen === "queue" && <Queue key="queue" />}
          {screen === "settings" && <Settings key="settings" />}
        </Suspense>
      </ErrorBoundary>
      <Toasts />
      {help && <Onboarding onClose={() => setHelp(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
