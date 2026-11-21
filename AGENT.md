# AGENT.md — Clipweave Web

Living guide for AI agents working in this repository. **Keep this file updated after every session/change set.**

## Purpose
- Single reference for rules, workflow, architecture context, and a running log of what changed.
- Minimize repeated deep code scans by relying on the maintained knowledge graph outputs in `graphify-out/` once generated.

## Repository
- **Project:** Clipweave (browser-based tool to turn live streams into vertical 9:16 clips; local/GPU-assisted AI workflows)
- **Stack:** React 19, TypeScript, Vite, local Node API middleware/server (`server/dev-api.cjs`, in this repo)
- **Platform:** Windows (`win32`)
- **Root:** `C:\Users\mushfiq\Documents\clipweave-web`

## Core rules (must follow)
1. **Log everything:** After each session or meaningful change, append/update the **Session log** in this file with date/time context (if known), intent, files changed, decisions, commands run, verification results, and open issues/blockers.
2. **Graph-first navigation:** After each session, run a graphify update/build so `graphify-out/` stays current. When `graphify-out/` exists, prefer reading `graphify-out/` artifacts (especially `GRAPH_REPORT.md`, `graph.json`, query results) to understand structure/relationships before considering broad source reads.
3. **Avoid full code reads when graph context is sufficient:** Do not read the entire codebase or large files unnecessarily. Use `graphify query`/graph outputs and targeted file reads only for the specific areas being changed.
4. **Targeted edits:** Inspect and modify only the relevant files for the task; keep diffs minimal and consistent with existing patterns/styles.
5. **Preserve user/external work:** Treat unfamiliar changes carefully; never revert unrelated modifications.
6. **Verify:** Run appropriate checks (`npm run typecheck`, `npm run build`, tests as relevant) after code changes when feasible; record outcomes.
7. **Respect environment boundaries:** The local API/server implementation may live outside this repo (e.g. `../web-server.cjs`). Document external dependencies/blockers instead of inventing them.
8. **UI quality:** For UI work, keep hierarchy, spacing, alignment, contrast, and responsive behavior intentional; avoid generic/sloppy patterns and fix clipping/overflow/backdrop issues properly.

## Graphify workflow
- **Initial build (if `graphify-out/` missing):** `graphify .` (use `--code-only` if no LLM API key is available for doc/image semantic extraction)
- **Incremental update (preferred after sessions once graph exists):** `graphify update .` (code/AST updates without LLM; for doc/paper/image semantic changes use the full graphify pipeline with an available backend)
- **Cluster/report refresh (if needed):** `graphify cluster-only .`
- **Query (when graph exists):** `graphify query "<question>"`, `graphify path "A" "B"`, `graphify explain "Node"`
- **Primary artifacts:**
  - `graphify-out/GRAPH_REPORT.md` — human-readable summary (god nodes, communities, surprises, questions)
  - `graphify-out/graph.json` — graph data for traversal/query tools
  - `graphify-out/graph.html` — interactive visualization (if generated)
- **Agent behavior:** After each coding session, update this log and run `graphify update .` (or initial build/cluster refresh as needed). Prefer graph outputs over full-source reads for orientation.

## Project guide (high-level)
- **Entry/UI shell:** `src/main.tsx`, `src/App.tsx`, global state in `src/store.tsx`
- **State subscriptions:** `useStore()` remains for existing screens; `useShellStore()` and `useViewerStore()` isolate the app shell and persistent Viewer from editor project updates
- **Screens:** `src/screens/` (`Viewer.tsx`, `Clips.tsx`, `Editor.tsx`, `Queue.tsx`, `Settings.tsx`)
- **Queue domain:** `src/queue/useRenderQueue.ts` owns queue persistence and render lifecycle; `src/screens/Queue.tsx` owns its UI
- **Editor internals:** `src/editor/` (preview, timeline, panels, player/composition flow)
- **Shared UI/components:** `src/components/` (`ui.tsx` modal/controls, onboarding, top bar, toasts)
- **Core libs:** `src/lib/` (project/types/settings/db/media/playback/compositor/render utilities, AI helpers in `src/lib/ai/`)
- **Styles/design tokens:** `src/styles/` (`tokens.css`, `base.css`, `app.css`), design notes in `DESIGN.md`
- **Dev API integration:** `vite.config.ts` mounts `server/dev-api.cjs` as middleware. That file is now a compatibility shim over `server/index.cjs` (handler + static + standalone start) and `server/router.cjs` (declarative route table). Routes live in `server/routes/*.cjs` (health, streams, media, clips, ai, facecam, models, render-legacy), services in `server/services/media.cjs`, and pure helpers in `server/lib/{http,multipart,proc,hls,files,id}.cjs`. An optional sibling `../web-server.cjs` is still accepted as a legacy fallback.
- **Server tests:** `npm run test:server` runs `node --test server` (12 tests for ranges, HLS rewriting, multipart, route lookup, playable selection). CI runs it after Vitest.
- **Docs:** `docs/` and `README.md`

## Known architecture notes (current)
- **Rendering/export:** Browser composites timeline frames with `drawFrame` onto a canvas whose stream, mixed with the timeline's sound, is recorded via `MediaRecorder` (`src/lib/render.ts`). No `/api/render` call sites exist in `src` (`npm run build` + `useRenderQueue` → `startRender` is the only path). The earlier server-side `/api/render/start|frames|finish` batched-upload flow noted below was replaced by this in-browser capture; the queue renders up to 3 jobs concurrently.
- **Separate finalize flow:** `src/lib/clipFinalize.ts` still targets `/api/clip/finalize` for clip finalization/remux use cases (distinct from timeline render export).
- **External dependency:** `../web-server.cjs` is outside the repo and may be missing in some environments; when absent, dev middleware is stubbed and `/api`, `/stream`, `/media`, `/ai` features (including render) require the external server implementation.

## Session log

### 2026-11-18 — Agent guide & knowledge graph bootstrap
- **Intent/request:** Create a detailed agent guide with rules/logging, run graphify update/build, and establish graph-first workflow (update after each session; prefer `graphify-out` over full code reads).
- **Changes (files + summary):**
  - `AGENT.md`: Created detailed agent guide including purpose, core rules, graphify workflow, project guide, architecture notes, and session log template/history.
  - `graphify-out/`: Generated initial knowledge graph artifacts via `graphify . --code-only` and `graphify cluster-only .`.
- **Decisions/rationale:**
  - Used `--code-only` for the initial build because no LLM API key was available for semantic extraction of docs/images; this still produced a structural code graph for navigation.
  - Recorded current rendering architecture and known external dependency on `../web-server.cjs` / `POST /api/render`.
- **Commands run & results:**
  - `graphify .` → failed (semantic extraction requires API key for docs/images).
  - `graphify . --code-only` → success (`graph.json`: 398 nodes, 1200 edges, 12 communities).
  - `graphify cluster-only .` → success (`GRAPH_REPORT.md`, `graph.html`, labels/analysis updated; community naming fell back to placeholders due unavailable labeling backend).
  - `npm run typecheck` (earlier in session context) → passed.
- **Graphify action:** Initial build completed (code-only). Ran `graphify update .` after creating/updating `AGENT.md` (no tracked code rebuild needed). Future sessions should run `graphify update .` after changes and use `graphify query` / `graphify-out/*` for orientation.
- **Open issues/follow-ups:**
  - No semantic/doc/image entities in graph yet (code-only). Re-run full extraction later if an LLM backend/key becomes available.
  - `../web-server.cjs` and server-side `POST /api/render` (FFmpeg/NVENC) remain external requirements.

### 2026 (session, context carried over) — Render pipeline & UI fixes
- **Intent:** Fix dev startup/API dependency issues, Clips/Queue/Settings/Editor UI problems, rendering behavior, and modal/backdrop glitches; move export to server-side FFmpeg.
- **Key changes:**
  - `vite.config.ts`: Added resilient loading for `../web-server.cjs`; when missing, warn and stub `/api|/stream|/media|/ai` with 503 JSON so dev server can start.
  - `src/screens/Clips.tsx`: Reworked Create AI clips modal (source selection layout, replaced numeric inputs with single-select dropdowns for max clips/min score/min/max seconds, modal flow adjustments).
  - `src/components/ui.tsx`: Added `AutoTextarea`, improved shared form primitives/segment structure, and made `Modal` width responsive (`min(100%, widthpx)`).
  - `src/styles/base.css`, `src/styles/app.css`: Multiple UI alignment/polish passes (cards/empty states/chips/actions centered, clip finder layout, queue/editor/timeline/inspector spacing, removed look-card drop shadow, textarea sizing behavior, removed queue render-description text, etc.).
  - `src/screens/Settings.tsx`, `src/lib/settings.ts`: Expanded/auto-sizing AI prompt, added 90 fps export option, removed `fastRender`/`gpuRender` toggles/fields, updated defaults/messaging for server-side FFmpeg+NVENC rendering.
  - `src/lib/render.ts`: Replaced in-browser WebCodecs/MediaRecorder rendering with server-side export pipeline (composite frames + WAV mix upload to `POST /api/render`).
  - `src/store.tsx`: Queue render flow now consumes server render result directly (removed post-render client NVENC finalize step for render outputs).
  - **Removed:** `src/lib/renderFast.ts`; removed `mediabunny` from `package.json`.
- **Popup/backdrop glitch fix (current pass):**
  - `src/styles/base.css`: Rebuilt modal overlay system to eliminate edge cropping/glitching and improve scrolling/containment (`inset: 0`, flex-centered backdrop, `overflow-y: auto`, themed overlay/surface, flex-column modal with fixed header/footer and scrollable body, responsive padding).
  - `src/styles/app.css`: Improved clip-finder description wrapping, responsive `.two` grid, and stable media preview sizing inside modals (`.clip-player`, `.render-player`).
- **Verification:** `npm run typecheck` passed after implemented change sets (including latest modal/CSS updates in this session context).
- **Open issues / blockers:**
  - External `../web-server.cjs` missing in this environment; required server endpoints (including `POST /api/render`) must be implemented/available outside repo for full render/API functionality.
  - Exact visual reproduction of originally reported popup glitch (image/screenshot) unavailable in text; fixes applied to shared modal system and common popup layouts.

### 2026-11-18 — Architecture review and first migration slice
- **Intent/request:** Review the current application architecture, research React/Vite/Next guidance, and make pragmatic improvements without migrating the stack.
- **Changes (files + summary):**
  - `src/queue/useRenderQueue.ts`: Extracted queue persistence, project snapshots, render scheduling, progress, and job actions from `src/store.tsx`.
  - `src/store.tsx`: Kept the existing `useStore()` API and delegated queue behavior to the new hook.
  - `src/App.tsx`, `src/screens/Viewer.tsx`: Lazy-load secondary screens and load `hls.js` only when an HLS stream needs it; the Viewer remains mounted.
  - `src/styles/app.css`: Added a small Suspense loading fallback style.
  - `docs/02-architecture.md`, `docs/04-editor.md`, `docs/05-ai-and-models.md`, `docs/06-api-reference.md`, `README.md`: Updated the Vite/server boundary, storage ownership, code-splitting, and timeline render flow; removed stale WebCodecs/fast-render claims.
  - `AGENT.md`: Added the queue module to the project guide and this session log.
- **Decisions/rationale:**
  - Kept Vite because the product is a local browser editor that relies on media elements, canvas, MediaRecorder, IndexedDB, and a local machine API. A Next.js migration is not justified by current product requirements.
  - Kept the app-wide store contract stable while extracting the queue, enabling the next state-boundary refactor to happen independently.
- **Commands run & results:**
  - `npm run build` → PowerShell blocked `npm.ps1` by execution policy.
  - `npm.cmd run build` → passed TypeScript and Vite production build; initial app chunk is 294.95 kB (down from 959.92 kB before screen/HLS splitting). HLS remains a separate 578.15 kB lazy chunk.
  - `git diff --check` → passed.
- **Graphify action:** `graphify update .` succeeded and rebuilt the working tree graph (409 nodes, 1,228 edges, 13 communities). The installed CLI is 0.9.102 while the graphify skill is 0.9.109; no LLM community relabeling was run.
- **Open issues/follow-ups:**
  - `src/store.tsx` still owns several unrelated domains behind one React context; split subscriptions only after profiling editor updates and Viewer re-renders.
  - The external sibling `../web-server.cjs` is absent in this checkout, so API behavior and end-to-end rendering cannot be verified here.

### 2026-11-18 — Shell and Viewer context isolation
- **Intent/request:** Continue the state-boundary migration by preventing editor project updates from notifying the persistent Viewer and app shell.
- **Changes (files + summary):**
  - `src/store.tsx`: Added memoized shell and Viewer contexts while keeping the existing `useStore()` context and API.
  - `src/App.tsx`: Shell now reads navigation and settings through `useShellStore()`.
  - `src/screens/Viewer.tsx`: Viewer and stream tiles now use `useViewerStore()`.
  - `docs/02-architecture.md`: Documented the additional contexts.
- **Decisions/rationale:** Split only the high-impact subscriptions first. The global context remains available to existing screens for incremental migration.
- **Commands run & results:**
  - `npm.cmd run build` → passed TypeScript and production build.
  - `npm.cmd test` → 5 test files and 35 tests passed.
  - `git diff --check` → passed.
- **Graphify action:** `graphify update .` rebuilt the working tree graph (415 nodes, 1,234 edges, 14 communities). CLI version mismatch and no LLM community relabeling remain as noted above.
- **Open issues/follow-ups:**
  - `TopBar`, `Toasts`, and other feature screens still subscribe to the shared `useStore()` context.
  - Build and unit tests do not directly measure React render counts; use the React Profiler during a timeline edit with active streams to quantify the improvement.

### 2026-11-18 — Default auto-caption setting
- **Intent/request:** Enable auto-caption by default.
- **Changes (files + summary):**
  - `src/lib/settings.ts`: Changed `DEFAULT_SETTINGS.autoCaptionOnClip` from `false` to `true` so newly loaded/default settings auto-caption added clips by default (users can still toggle it off in Settings → Clipping).
- **Decisions/rationale:** Minimal, targeted default-value change; existing settings UI and clip flows already honor `settings.autoCaptionOnClip`.
- **Commands run & results:** `npm run typecheck` → passed. `graphify update .` → ran successfully (incremental re-extraction; no code-graph topology/output changes detected).
- **Graphify action:** Updated after changes (`graphify update .`). No broad source reads required; change was limited to `src/lib/settings.ts`.
- **Open issues/follow-ups:** Existing users with saved settings in local storage will keep their previously saved preference unless settings are reset.

### 2026-11-18 — Perf/risk fixes: streaming render upload, thumbnails off localStorage
- **Intent/request:** Fix the critical and high findings from the whole-app review: render frame memory, clip metadata quota loss, silent black renders, the stale browser-side MP4 gate, and Clip Finder's status-poll fall-through.
- **Changes (files + summary):**
  - `src/lib/multipart.ts` (new): streaming `multipart/form-data` encoder with one-part backpressure, plus `supportsStreamingBody()` capability probe (`duplex: "half"`).
  - `src/lib/render.ts`: frames are now produced lazily and streamed as they are encoded on Chromium; the old accumulate-into-FormData path remains as fallback. Footage that never decoded fails the job with a named error before the upload starts, instead of rendering black; repeated frames due to seek timeouts surface through `opts.onWarning` (previously unused).
  - `src/lib/thumbs.ts` (new), `src/components/ClipThumb.tsx` (new), `src/lib/types.ts`: clip thumbnails move to IndexedDB (`thumb:<clipId>`, `Clip.thumbKey`), resolved on demand with a bounded object-URL cache.
  - `src/store.tsx`: one-time migration of inline data-URL thumbs, thumb deletion on clip delete, and a user-facing toast when localStorage hits quota (previously a silent `console.warn`).
  - `src/lib/util.ts`: `saveJson` reports failure through `setJsonSaveErrorHandler` and returns a boolean.
  - `src/screens/Viewer.tsx`, `src/screens/Clips.tsx`, `src/screens/Editor.tsx`: store/resolve thumbnails through the new helpers; Clip Finder now throws on preparation timeout instead of analysing an unready asset.
  - `src/lib/settings.ts`, `src/screens/Settings.tsx`: removed `canRecordMp4()`; export format is no longer gated on the browser's MediaRecorder support now that the server encodes.
  - `src/lib/multipart.test.ts` (new): asserts byte-identical output against the platform FormData serialiser, part order, lazy production, and producer-error propagation.
- **Decisions/rationale:** Kept the `/api/render` multipart contract byte-identical so `../web-server.cjs` needs no change; streaming is capability-gated because non-Chromium browsers cannot send a `ReadableStream` body.
- **Commands run & results:** `npm run typecheck` → passed. `npx vitest run` → 6 files / 39 tests passed. `npm run build` → passed (614 ms).
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** The streaming upload path could not be exercised end-to-end because `../web-server.cjs` is absent from this checkout; verify one render on Chrome before relying on it. The store still re-renders every `useStore()` consumer at queue-progress rate, the editor still reads layout during render, and `buildAudioWav` is still a JS per-sample loop.

### 2026-11-18 — Review follow-up: state split, editor render cost, audio mix, a11y
- **Intent/request:** Work through the remaining review findings (performance, UX/accessibility, small correctness items) after the critical/high fixes.
- **Changes (files + summary):**
  - `src/store.tsx`: added a `QueueCtx`/`useQueue()` so render-progress ticks no longer invalidate every `useStore()` consumer; settings saves are debounced and `applyAppearance` only runs for appearance fields; `setProject` updates `projectRef` immediately; mirrored audio is created with `auto: true`.
  - `src/screens/Queue.tsx`, `src/screens/Settings.tsx`, `src/components/TopBar.tsx`: read queue state through `useQueue()`; queue partitioning is O(n).
  - `src/editor/player.ts`: stable `Player` object via `useMemo` over `useCallback` actions, so consumers no longer re-subscribe every render.
  - `src/editor/Timeline.tsx`: width measured by `ResizeObserver` instead of during render; playhead auto-scroll coalesced into one rAF; `aria-valuetext` on handles; text blocks are a labelled `group` rather than a slider containing sliders.
  - `src/editor/panels.tsx`: facecam mirror timer reads project/player through a ref instead of restarting on every render.
  - `src/lib/render.ts`: audio mix moved to `OfflineAudioContext` with gain nodes and peak normalisation (removes the per-sample JS loop, nearest-neighbour resampling and hard clipping).
  - `src/queue/useRenderQueue.ts`: queue persistence flushes on status changes and coalesces progress writes.
  - `src/lib/compositor.ts`: caption pagination cached per captions-array identity.
  - `src/lib/recorder.ts`, `src/lib/ai/audioSample.ts`, `src/screens/Viewer.tsx`: AI sampling reuses the rolling recorder's audio track; closing a stream clears its stale sound/focus ids.
  - `src/lib/project.ts`, `src/screens/Editor.tsx`, `src/editor/panels.tsx`, `src/lib/types.ts`: deleting a video clip also removes its mirrored (`auto`) audio, unless another clip still uses that media.
  - `src/components/ui.tsx`, `src/components/Toasts.tsx`, `src/lib/ai/openai.ts`: modal focuses the first field/primary action and locks background scroll; error toasts use `role="alert"`; `tryParseJson` scans balanced objects; `NumberInput` keeps typed text while focused.
  - `src/lib/ai/openai.test.ts`, `src/lib/project.test.ts`: added coverage for adjacent JSON objects, braces inside strings, and mirrored-audio deletion.
- **Decisions/rationale:** Kept `Clips`/`Project`/`QueueJob` shapes compatible (only optional `thumbKey` and `auto` were added). Audio gain changes on files that used to clip intentionally — peak normalisation replaces hard distortion.
- **Commands run & results:** `npm run typecheck` → passed. `npx vitest run` → 6 files / 44 tests passed. `npm run build` → passed (552 ms).
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** Not done: caption audio extraction (needs a server-side ffmpeg endpoint), refcounted object URLs in `src/lib/db.ts`, and a render-seek benchmark before changing the frame capture model. Streaming upload and thumbnail migration still need one manual pass in Chrome against the local server.

### 2026-11-18 — In-repo local API server
- **Intent/request:** `npm run dev` printed `../web-server.cjs not found; local /api routes disabled`, so stream resolution, clipping, rendering and captions were all unavailable.
- **Changes (files + summary):**
  - `server/dev-api.cjs` (new): dependency-free Node API covering the documented contract — stream proxy with HLS rewrite and segment cache, yt-dlp resolve/prepare with `/media` range serving, ffmpeg render (multipart frames + WAV), clip finalize and cut with thumbnails, captions/analyze via the `nemo-speech` CLI, facecam via `scripts/facecam_detect.py`, model catalog/download, AI chat proxy and `/api/health`. Streams multipart bodies to disk rather than buffering, so the new chunked render upload works.
  - `vite.config.ts`: loads the in-repo server first, keeps `../web-server.cjs` as a legacy fallback, and updates the disabled-API message.
  - `package.json`: added `npm run server` for the standalone (port 8080) mode that serves `dist/`.
  - `README.md`, `docs/06-api-reference.md`: point at `server/dev-api.cjs`, document the finalize response shape and the model catalog location.
- **Decisions/rationale:** The old sibling file was never committed and is absent from this checkout, so a fresh clone could not run the app. Keeping the server in-repo makes `npm run dev` self-contained while leaving existing external setups working.
- **Commands run & results:** `node --check server/dev-api.cjs` → OK. `tsc --noEmit` → passed. Live checks against Vite on 5173: `/api/health` (`ffmpeg`, `yt-dlp`, `nemo` all true, NVENC detected), `/api/models` (catalog + installed flags), multipart `/api/render` both as `curl -F` and as a **chunked streaming** upload (24 frames + WAV → 540×960 H.264/AAC MP4), `/api/clip/finalize` (WebM → 1.5 s MP4 with audio/video headers), `/api/upload` + `/api/media/status` + `/api/clip/cut` (cut MP4 + base64 thumbnail), `/stream` image proxy with `file://` rejection and HLS playlist rewriting, `/api/facecam/detect` (YuNet on a test frame, 0 faces), `/api/ai/chat` unconfigured → 400 with a clear message.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** `/api/captions/generate` and `/api/analyze` were not exercised end-to-end because no ASR model is downloaded yet (a 630 MB pull); `/api/resolve` and `/api/media/prepare` were not run against a live YouTube/Twitch URL. `/stream` only proxies direct media and HLS — DRM/login-protected streams remain unsupported as documented.

### 2026-11-18 — Render "Failed to fetch": batched frame upload
- **Intent/request:** Every render in the Queue finished as `Failed to fetch`, so no export could be produced.
- **Root cause:** The streaming upload added earlier that day used a `ReadableStream` request body. Chrome only permits those over HTTP/2; Vite serves HTTP/1.1, so `fetch` rejected within ~7 ms before a byte left the renderer. Node's `fetch` (undici) allows HTTP/1.1 streams, which is why the earlier check passed, and `supportsStreamingBody()` only proves the `Request` constructor accepts a stream — not that the transport can send it.
- **Changes (files + summary):**
  - `src/lib/render.ts`: replaced the single streaming request with a session upload — `POST /api/render/start`, batches of 48 frames to `/api/render/frames?id=`, then `POST /api/render/finish?id=` with the mixed WAV. Failures and cancels call `/api/render/abort?id=`. Peak memory is one batch (~10-15 MB) instead of the whole export.
  - `src/lib/multipart.ts`, `src/lib/multipart.test.ts`: deleted; the custom encoder can no longer be used from a browser.
  - `server/dev-api.cjs`: added `/api/render/start|frames|finish|abort` backed by a session map with a one-hour reaper; extracted `encodeFrames()` so the single-request `/api/render` and the session flow share one FFmpeg path.
  - `vite.config.ts`: the dev server now watches `server/dev-api.cjs` and restarts when it changes (the module is `require`d once), and `setApiBase` uses the port actually bound instead of assuming 5173.
  - `docs/06-api-reference.md`: documented the session endpoints and why the app does not use a streaming body.
- **Decisions/rationale:** Batches work on HTTP/1.1 in every browser, keep the request small enough for a dev server, and need no certificates, proxy or HTTP/2 setup. Kept `/api/render` for `curl`/scripted use and as the documented single-shot contract.
- **Commands run & results:** `npm run typecheck` → passed. `npx vitest run` → 5 files / 40 tests passed. `npm run build` → 540 ms. `node --check server/dev-api.cjs` → OK. Headless Chrome against Vite (port 5199) posting 100 canvas JPEGs: `start` 200, three batches of 48/48/4 each 200, `finish` 200 with a 237 KB MP4, unknown session 404, unknown abort 200. Legacy `curl -F /api/render` → 200, 8,788 bytes. Touching `server/dev-api.cjs` restarted the dev server.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** The batch size is a constant; a very slow disk could still spike memory on a 48-frame batch of large JPEGs. `markRaw`-style object URL refcounting in `src/lib/db.ts` and the render-seek benchmark remain open from earlier sessions.

### 2026-11-18 — AI Clip Finder subline condensed to one line
- **Intent/request:** User asked for the AI Clip Finder blurb to fit on a single line ("signel line").
- **Changes (files + summary):**
  - `src/screens/Clips.tsx`: subline under "AI Clip Finder" shortened from "Turn a YouTube link or a local file into ready-to-edit clips. Transcribed on your GPU; the best moments are saved here automatically." to "YouTube link or local file in: GPU-transcribed, edit-ready clips, saved here."
- **Decisions/rationale:** Kept the three facts (source, GPU transcription, clips saved); dropped "manually" phrasing and the second sentence. No em dash (house copy rule). Dropped "automatically" to fit one line.
- **Commands run & results:** `npm run typecheck` → passed.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** None.

### 2026-11-18 — Captions in Clips preview + 3 concurrent queue renders
- **Intent/request:** (1) Auto-caption was on for clipping but the Clips preview showed no captions on the video. (2) "mulpter readner single time, max 3" — allow multiple renders at the same time, max 3.
- **Changes (files + summary):**
  - `src/screens/Clips.tsx`: `ClipPreview` now overlays the clip's word-level captions on the video, same pagination (`captionPages`, 3 words/line) and style (caps, highlight = accent, `#fafafa` accent falls back to `#facc15`, Bebas/TikTok/Inter per `settings.defaultCaptionFont`, y ≈ 0.7) as the editor canvas. rAF loop drives the current word highlight; overlay only renders when `clip.captions` exists.
  - `src/styles/app.css`: added `.clip-preview-frame` (positioning + `container-type: inline-size`) and `.clip-captions` (font-size in `cqw`, em-based black stroke via text-shadow) next to `.clip-player`.
  - `src/queue/useRenderQueue.ts`: single `handle` ref replaced with a `handles` Map; the effect starts up to `MAX_CONCURRENT_RENDERS` (3) queued jobs per pass. Pause/resume and cancel/remove now act on every live job (`setPausedAll` toggles all). Finished jobs free their slot and the next queued job starts.
  - `src/screens/Queue.tsx`: pagehead copy updated to say renders run up to 3 at once.
- **Decisions/rationale:** Realtime in-browser render is kept (no server round-trip); 3 concurrent jobs share the tab's rAF, so each render still advances by wall-clock and may drop/repeat frames under contention — output duration stays correct. Word-highlight overlay reuses `captionPages` instead of duplicating pagination; clip captions are blob-relative and the preview video seeks the blob too, so no time offset is applied (`clip.in` only shifts the initial seek, matching viewer-clip semantics).
- **Commands run & results:** `npm run typecheck` → passed. `npm run build` → passed (938 ms; pre-existing chunk-size warning). `npx vitest run` → 5 files / 40 tests passed.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** Caption overlay in Clips preview was not exercised live in a browser; worst case under three simultaneous renders is frame repetition (already reported by the renderer's onWarning).

### 2026-11-18 — Viewer: stream bubbles rail + live-view lag fixes
- **Intent/request:** Real-time multi-stream view was laggy ("give lag to the stream fix it and improve it"), and the user wanted chat-style profile bubbles on the left side to solo one stream or multi-select several to watch at once.
- **Changes (files + summary):**
  - `src/screens/Viewer.tsx`: new left `viewer-rail` with one bubble per stream (initials on a per-stream hue tint, LIVE dot, sound badge, pick-order badge, tooltip with gesture hint). Plain click solos a stream (click again / All bubble to reset); Ctrl/Cmd+click adds to a multi-pick; a `ListChecks` toggle at the rail foot makes plain taps toggle too (touch-friendly). Unpicked tiles stay mounted (`hidden` attr) so rolling buffers and HLS sessions survive selection. `StreamTile` is now `memo` with id-parameterized stable callbacks — typing in the link box no longer re-renders every tile. HLS config: `liveSyncDurationCount` 3→2, `liveMaxLatencyDurationCount: 6`, `maxLiveSyncPlaybackRate: 1.5` (catches up to live edge instead of drifting), `backBufferLength` 30→15, `maxBufferLength` 30→20, `maxMaxBufferLength` 60→40.
  - `src/lib/recorder.ts`: rolling-recorder bitrate 4.0→2.5 Mbps per recorder (two run per stream).
  - `src/styles/app.css`: `.viewer` is now row layout; new `.viewer-content` (padding/gaps), `.viewer-rail`, `.rail-bubble` (squircle on hover/selected via border-radius, brand ring when picked, hue tint via `--h`), `.rail-live`/`.rail-sound`/`.rail-order` badges, CSS tooltips, `.tile[hidden]`, narrow-width breakpoint.
- **Decisions/rationale:** Hiding via `hidden` instead of unmounting preserves each tile's HLS session and rolling recording when soloing/multi-picking (unmounting would re-download and reset the buffer every selection change). Initials/hue are derived locally; no platform avatars are fetched. `liveSyncOnStall` does not exist in installed hls.js types, so latency catch-up is `maxLiveSyncPlaybackRate` + `liveMaxLatencyDurationCount` instead. 3× decode is still inherently heavy; capLevelToPlayerSize keeps small tiles on low ABR levels.
- **Commands run & results:** `npm run typecheck` → passed (after removing nonexistent `liveSyncOnStall`). `npm run build` → passed (633 ms; pre-existing chunk-size warning). `npx vitest run` → 5 files / 40 tests passed.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** Rail bubbles not exercised live against real streams; latency/ABR behavior should be checked against an actual Twitch/Kick/YouTube HLS source. If solo view still feels choppy, next lever is forcing a low fixed level on non-focused tiles.

### 2026-11-18 — Rail bubbles show live stream previews; another lag pass
- **Intent/request:** Screenshot showed the rail bubbles rendering as bare "11" initials; user asked to "show stream preview and fix the lag please".
- **Changes (files + summary):**
  - `src/screens/Viewer.tsx`: `TileApi` gained `video()`; the rail bubbles now contain a 96×96 `<canvas class="rail-preview">` that every ~1.2 s gets a cover-cropped `drawImage` of the tile's video (skips when tab hidden or video not decoded) — preview without an extra decoder. Initials remain as the fallback underneath; badges sit above via z-index. HLS `maxBufferLength` 20→15, `maxMaxBufferLength` 40→30, `backBufferLength` 15→10.
  - `src/lib/recorder.ts`: rolling-recorder bitrate 2.5→2.0 Mbps per recorder (two per stream).
  - `src/styles/app.css`: `.rail-preview` (border-radius: inherit, overflow hidden, z-index 1) and badge z-index 2.
- **Decisions/rationale:** Preview reuses the tile's decoded frame — zero extra video decoders; ~1.2 s cadence is enough at 46px. canvases paint outside React's render path (direct canvas ops in an interval), so previews don't re-render tiles or the rail.
- **Commands run & results:** `npm run typecheck` → passed. `npm run build` → passed (770 ms). `npx vitest run` → 40 tests passed.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** Still bounded by the machine's decode budget for N simultaneous HD streams; if it remains choppy, cap non-focused tiles to a fixed low level (e.g. 480p) via `hls.currentLevel`. Preview freshness is ~1.2 s; raise the interval if the rail ever feels busy.

### 2026-11-18 — AI titles for clips + live-stream latency research & docs
- **Intent/request:** "use ai to generate title for video too for those clips" plus "research then fix" the lag with web search required for "improve the project".
- **Changes (files + summary):**
  - `src/lib/ai/openai.ts`: new `suggestTitle()` — one short creator-style title (max 60 chars) from a transcript, `tryParseJson`-tolerant, empty string on garbage.
  - `src/screens/Clips.tsx`: each clip card gets a Sparkles icon button (top row, next to Favourite) that titles the clip from its transcript; if the clip has no stored captions it transcribes the clip on the spot first (`generateCaptionsForBlob`). Result is written to `clip.streamTitle`.
  - `docs/09-live-streams.md` (new, linked from `docs/README.md`): latency floor per platform, what the player is configured to do and why, proxy considerations, research-note honesty about the empty web-search result. Tuning applied lives in `Viewer.tsx` (liveSyncDurationCount 2, liveMaxLatencyDurationCount 6, maxLiveSyncPlaybackRate 1.5, lowLatencyMode left at hls.js default true, bounded buffers).
  - `server/dev-api.cjs`: verified the `/stream` proxy rewrites `URI="..."` on LL tags (`PART`, `PRELOAD-HINT`, `SERVER-CONTROL` passthrough untouched) and forwards query strings, so blocking playlist reloads still work; no code change needed.
- **Decisions/rationale:** `suggestTitle` writes `streamTitle` because that is the clip card's heading; user notes (`[AI score] reason`) are untouched. LL-HLS is left to hls.js's default `lowLatencyMode: true` instead of a manual config echo of the same default. Kept the `/stream` proxy for CORS safety rather than switching to direct origin fetches (unverifiable per-platform CORS guarantees).
- **Commands run & results:** `npm run typecheck` → passed. `npm run build` → passed (960 ms). `npx vitest run` → 40 tests passed.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** Web search returned no results (integration issue), so "research" here is from the installed hls.js docs/source; verify against a live Twitch LL channel with a real proxy setup. AI title untested against a real endpoint. If titles should also feed the Queue/render filename pattern, that is a follow-up (fileNameFor already supports `{title}`).

### 2026-11-18 — AI check interval is now a 3–15 minute dropdown
- **Intent/request:** "Check interval … make this dorp down lsiteform minite, 3 to 15 minite" — the AI auto-clip check frequency becomes a dropdown in minutes, 3 to 15.
- **Changes (files + summary):**
  - `src/lib/settings.ts`: `aiClipInterval` re-typed to `number` (minutes), default 3; one-time migration (`clipkit.settings.aiIntervalMinutes.v1`) maps legacy second-based values (10/20/30/60 ≤ 60) to 3; loaded value clamped to 3–15.
  - `src/screens/Settings.tsx`: the segmented seconds control (10/20/30/60 s) replaced with a `.select` dropdown listing 3–15 minutes.
  - `src/screens/Viewer.tsx`: poll delay `Math.max(3, aiClipInterval) * 60 * 1000`; toast text now says "every N min".
- **Commands run & results:** `npm run typecheck` → passed. `npm run build` → passed (786 ms). `npx vitest run` → 40 tests passed.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** None. Existing sessions migrate silently to 3 min; users wanting the old cadence can pick 3 min — there is intentionally no sub-minute option.

### 2026-11-18 — Recommend tab = recorded clips gallery; Colab MiMo endpoint with Local/Cloud toggle + Drive model cache
- **Intent/request:** (1) "not recommender clips recoored clips" — Recommend shows the recorded clips, not separate recommendation records. (2) Connect the MiMo Heretic 9B served by `mimo_v26_heretic_ollama_colab.ipynb` to the app with a Local↔Cloud toggle, and make Colab sessions use prebuilt/cached model instead of re-building each run; websearch required.
- **Changes (files + summary):**
  - `src/lib/types.ts`: Recommendation record removed; `Clip` gains `aiTitle?`, `aiGroupId?`, `aiGroupStreams?`.
  - `src/store.tsx`: dropped the `clipkit.recommendations.v1` slice, `addRecommendation`/`removeRecommendation`, and the `deleteClip` pruning; Store/ViewerStore picks cleaned up. Screen `recommend` unchanged.
  - `src/screens/Viewer.tsx` (headless): AI pass passes `title`, `groupId`, `streams` through `clip()`; grouped moments land on the clip itself; toast now says "saved to Clips". Empty-state copy updated.
  - `src/screens/Clips.tsx`: Clip Finder sets `aiTitle: p.title` on saved clips.
  - `src/screens/Recommend.tsx`: gallery of ALL non-removed recorded clips, newest first; clips sharing `aiGroupId` merge into one "Moment in N streams" card; X soft-removes (Removed filter); Preview/Open-in-editor per clip; AI score + length badges.
  - `src/lib/settings.ts`: `aiBaseUrl/aiApiKey/aiModel` replaced by `aiProfile: "local"|"cloud"` + `aiLocal`/`aiCloud` `AiProfile { baseUrl, apiKey, model }`; `activeAi()` helper; one-time migration maps the legacy triple into the cloud profile and activates it; legacy-default fingerprint cleanup now applies to the cloud profile. Local default: `http://localhost:11434/v1`, model `mimo-v2.6-heretic`.
  - `src/lib/ai/openai.ts`: all call sites take the `aiProfile|aiLocal|aiCloud` pick and resolve the active profile via `activeAi()`; behavior unchanged for direct endpoints, `/api/ai/chat` fallback preserved.
  - `src/screens/Settings.tsx`: the single endpoint triple became a Local/Cloud Seg toggle with per-profile Base URL / API key / Model fields (test connection works unchanged against the active profile); Colab hint text inline.
  - `mimo_v26_heretic_ollama_colab.ipynb`: new section 1.5 — optional Google Drive model cache (`OLLAMA_MODELS` pointed at `/content/drive/MyDrive/ollama-models` before `ollama serve`); pull cell skips pull+alias creation when the alias is present; serve cell forwards `OLLAMA_MODELS`. Top cell updated.
  - `docs/11-colab-ai.md` (new): connect steps, toggle, cache notes, tunnel-URL caveat, local Ollama alias instructions. Linked from `docs/README.md` and `README.md`.
- **Decisions/rationale:** Recommendations were history records duplicating clip data; moving `aiGroupId`/`aiTitle` onto the clip deleted a whole storage layer and simplified delete semantics (one source of truth). Local profile default matches the notebook alias so the toggle works with zero config locally; legacy values migrate to cloud because that is the common use case. Drive cache uses stock Ollama behavior (`OLLAMA_MODELS` before `serve`) — no custom runtime, no registry hacks (confirmed via ollama docs + community Colab notebooks).
- **Commands run & results:** `npm run typecheck` → passed. `npm run build` → passed (616 ms). `npx vitest run` → 40 tests passed.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** Notebook cache cells were edited but not executed on a real Colab runtime (cannot from here); first Drive-mounted run is unverified. Tunnel URL/key regenerate per session by design. Recommendation-key cleanup: `clipkit.recommendations.v1` is orphaned on disk (harmless; can be cleared manually).

### 2026-11-18 — Viewer activity console + AI failure surfacing (root cause of "no clips after 15 min")
- **Intent/request:** User saw nothing on the Recommend tab after 15 minutes with a 10-minute interval ("i add stream and … no reason file on recommend tab"), then asked for an old-school small log box docked bottom-center of the Viewer showing what's happening.
- **Root cause (verified on this machine):** `/api/health` → ffmpeg/yt-dlp/nemo/NVENC all present, BUT `/api/models` reports `installed: false` for every caption model — NeMo-Speech transcription throws, the error was swallowed by the `catch {}` in the AI interval, so no verdicts, no clips, no feedback. The card also showed "AI every N min" even when AI auto clip was off (default).
- **Changes (files + summary):**
  - `src/lib/activity.ts` (new): in-memory 80-entry activity feed (`logActivity/getActivity/subscribeActivity/clearActivity`) for the Viewer console; no persistence.
  - `src/screens/Viewer.tsx`: floating bottom-center `ActivityLog` console (monospace, tone-colored lines, collapse/clear, autoscroll); every pipeline stage logs — recording start/block, AI check results (`AI 6/10 — title`), clip-worthy hits, clustering, saved clips, manual Clip saves, stream add/remove, and errors. AI interval now (a) uses `settingsRef` + specific deps (timer isn't rebuilt on unrelated settings), (b) runs one immediate check when the toggle flips on / app loads with it on, (c) records per-stream failures into `aiErrors` state and shows them on the card ("AI can't listen: …", plus one toast per stream), (d) shows "AI off — enable in the bar above" when aiAutoClip is off instead of implying it's listening, (e) logs "no usable audio/speech" instead of silence when the AI can't sample the stream. Card's ai-state also warn-styled accordingly.
  - `src/styles/app.css`: `.viewer` is now `position: relative`; new `.activity-log*` console styles (floating panel, `Inter Mono`, tone colors) + `.ai-state.warn`.
- **Decisions/rationale:** The log is a render-time subscription (`useSyncExternalStore`) over a module-level feed — zero cost when empty, no store chatter, no persistence (it's a console, not history). The 10-minute "nothing happens" was not the timer; checks only fire on the interval and would have logged nothing. The primary user action needed: download a caption model in Settings → AI (Parakeet TDT ~630 MB), and confirm the AI auto clip toggle is on and the AI endpoint (Local/Cloud) answers Test connection.
- **Commands run & results:** `npm run typecheck` → passed. `npm run build` → passed (659 ms). `npx vitest run` → 40 tests passed. Live probe of the running dev server (port 5199, then stopped): `/api/health` ok; `/api/models` all `installed:false` — the diagnosis.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** End-to-end auto-clip still unverified until a caption model is downloaded on this machine (user action required). Activity log is Viewer-local and ephemeral by design. If toasts become too chatty with multiple failing streams, per-stream toast is already gated to once per stream per failure streak.

### 2026-11-18 — Clips from headless streams were audio-only + frozen frame; fix
- **Intent/request:** "generate clips have only audio and frame of stream; it should have the video and audio — fix it."
- **Root cause:** The headless rewrite hid the decoder with `display:none`. A `display:none` video has no layout box, so Chrome stops producing frames; `video.captureStream()` then delivers a frozen first frame plus a live audio track — exactly the reported symptom (audio present, one static image, no motion).
- **Changes (files + summary):**
  - `src/screens/Viewer.tsx`: the hidden decoder is now `<video className="stream-headless-video" />` instead of `display:none`.
  - `src/styles/app.css`: `.rec-card` is `position: relative; overflow: hidden`; new `.stream-headless-video` — absolute, 2×2 px, `opacity: 0.01`, `pointer-events: none`. Rendered but invisible, so the compositor keeps the video-frame pipeline alive.
- **Decisions/rationale:** 2×2 px at opacity 0.01 (not `visibility: hidden`, not `display: none`, not zero size) is the reliable browser pattern for offscreen decode+capture. Video must keep its layout box and non-zero opacity; captureStream/MediaRecorder then see real frames.
- **Commands run & results:** `npm run typecheck` → passed. `npm run build` → passed (955 ms). `npx vitest run` → 40 tests passed.
- **Graphify action:** `graphify update .` run after the change set.
- **Open issues/follow-ups:** Must be re-tested with a live Kick/Twitch source — previously saved audio-only/frozen clips can't be repaired retroactively. If any stream still captures frozen video, check whether the source itself is audio-only HLS (yt-dlp `-F`).

### 2026-11-18 — Hassle-free real-time stream recording + Record gallery
- **Intent/request:** "add new feature, hassle-free stream recording, that records stream in real time and saves in record gallery; in settings set auto-save recording after some time; real-time recording must not lag the stream video. Do web search and fix." Then: apply the antislop-copywriting and ui-ux-pro-max skills to the website.
- **Research (web search):** MDN MediaRecorder guidance on timeslice/chunks (individual chunks are not playable, concatenate in arrival order); W3C and Stack Overflow notes that WebM headers are emitted only on a fresh `start()`, so `stop()`/`start()` segments need their own recorder; chunk flushing to IndexedDB for long sessions; `contentHint = "motion"` and low bitrate for smooth live video. Applied all four.
- **Changes (files + summary):**
  - `src/lib/recorder.ts`: added `captureVideo()` (capture once, reuse stream), `hintForMotion()`, and `RollingRecorder.mediaStream()`. Added `LiveRecorder`: one extra VP8/Opus 1.2 Mbps MediaRecorder, 2 s timeslice, chunks flushed to IndexedDB as they arrive, segment rotation on a configurable timer with a fresh WebM header per segment, in-memory fallback if IDB writes fail, flush on stop/unmount/source-end, reschedulable interval via `setSegmentSeconds()`.
  - `src/lib/settings.ts`: `autoRecord` (default false) and `recordSaveMinutes` (1/5/10/15, default 5) with load-time clamp.
  - `src/lib/types.ts`: `Clip.recording?` marker.
  - `src/screens/Viewer.tsx`: Auto record toggle in the bar, per-tile Record/Stop button with `aria-pressed`, REC elapsed badge, segment saving through `finalizeClip` + `putBlob` + `addClip`, activity log entries and toasts. Shared capture stream means no second decode.
  - `src/screens/Settings.tsx`: Clipping section gains the master switch and interval Seg control.
  - `src/components/TopBar.tsx` + `src/screens/Recommend.tsx`: tab relabelled "Records" with a Disc icon; gallery heading "Record gallery"; `Recording` chip on auto-saved clips.
  - `src/styles/base.css` + `src/styles/app.css`: `.btn.rec-on`, `.chip.recording`, `.rec-live`/`.rec-dot` (reuses `livering`, already covered by `prefers-reduced-motion`), `.viewer-actions` wrapping, nowrap on the REC badge.
  - `src/lib/settings.test.ts` (new): defaults, preserved value, invalid-value fallback.
  - `README.md`, `docs/03-viewer-and-clipping.md`, `docs/10-recommend-mode.md`, `docs/README.md`: feature, settings and gallery documentation.
- **Decisions/rationale:** A separate low-bitrate recorder avoids changing the rolling buffer's clip length. Sharing the captured MediaStream avoids a second decode of the same live video. Each auto-save closes one MediaRecorder and starts a new one because timeslice chunks from separate runs do not concatenate into a playable WebM. Chunks go to IndexedDB immediately so a long recording does not grow unbounded JS memory. Remuxing stays on the local API (NVENC) so main-thread work is unchanged. New user-facing copy avoids em dashes and unverifiable claims per the antislop-copywriting skill; the app's older copy keeps its established voice. UI changes follow ui-ux-pro-max guidance: pressed state on toggles, decorative icons hidden by lucide defaults, compact labels nowrap, actions row wraps, reduced-motion already global.
- **Commands run & results:** `npm run typecheck` passed (after fixing a duplicate `stream` identifier and a null-padded `Settings.tsx` left by the server restart). `npm run build` passed (961 ms, pre-existing hls chunk-size warning). `npm test` passed (6 files, 43 tests).
- **Graphify action:** `graphify update .` succeeded (560 nodes, 1670 edges, 12 communities; CLI 0.9.102 still older than the 0.9.109 skill, no LLM relabeling).
- **Open issues/follow-ups:** Live recording not exercised against a real live stream here. Segment boundaries can drop a few frames because MediaRecorder stop/start is not gapless. Orphaned `rec:` chunk keys can remain in IndexedDB if the tab closes mid-segment; harmless and not yet swept. Auto-save of a long segment uploads the full WebM to `/api/clip/finalize`; verify on a slow disk.

### 2026-11-18 — Save recordings on stop, route them only to Records, keep audio
- **Intent/request:** "when I stop recording, auto save [and] show [it] in the recording library"; then "record save go to clips not recording gallery, fix it"; then "mostly remember record video and audio".
- **Changes (files + summary):**
  - `src/screens/Viewer.tsx`: `saveSegment` now writes the WebM and calls `addClip` **before** MP4 remuxing, so a stopped recording appears in the gallery immediately. Finalization runs in the background and replaces the stored blob via `putBlob` + `forgetUrl` + `updateClip` when it succeeds. Added a `saving` state, so the tile button reads `Saving` with a spinner until the flush finishes. `LiveRecorder.stop()` now returns a `Promise<void>` for that state. Before recording, `captureTracks()` verifies live video and audio tracks and warns when audio is missing. The headless video is set to `muted = false`, `volume = 0.001` instead of `muted`.
  - `src/store.tsx`: `updateClip` added to the ViewerStore pick and memo value.
  - `src/screens/Clips.tsx`: filters out clips with `recording: true`, so continuous recordings only appear in the Records gallery. Removed count and page copy updated.
  - `src/components/TopBar.tsx`: the Clips badge excludes recordings.
  - `src/lib/recorder.ts`: new `captureTracks()` helper; minimum saved segment lowered to 0.5 s; `stop()` now returns the rotate promise.
  - `README.md`, `docs/03-viewer-and-clipping.md`: updated behavior notes.
- **Decisions/rationale:** The old flow added the clip only after `finalizeClip` returned, so a busy/absent server delayed or hid the gallery entry. Writing the playable WebM first makes the save visible and the stop action feel immediate. Clips and Records share one `clips` array, so filtering on the `recording` marker in Clips gives the separate-gallery behavior without a second storage layer. Web research confirmed the W3C rule that muting should not affect captured audio, plus a long-standing Chrome/Firefox regression where a muted element captured silence; near-zero volume is the documented workaround.
- **Commands run & results:** `npm run typecheck` passed (after adding `updateClip` to ViewerCtx and moving the React-unsupported `volume` JSX prop into the playback effect). `npm run build` passed (707 ms). `npm test` passed (6 files, 43 tests).
- **Graphify action:** `graphify update .` succeeded (561 nodes, 1675 edges, 11 communities).
- **Open issues/follow-ups:** The background MP4 replacement invalidates the blob URL cache, but an already-open preview keeps the earlier WebM until reopened. Audio-less sources are only warned about in the activity log. Not exercised against a live stream here.

### 2026-11-18 — Auto-save timer reliability and Save now
- **Intent/request:** "after record time complete it not save [and] show on recorded gallery, please fix it".
- **Changes (files + summary):**
  - `src/lib/recorder.ts`: `onRotate` callback on segment close, a 4 s watchdog so a missing `stop` event cannot hang a segment, and a public `flush()` that saves the current segment while recording continues.
  - `src/screens/Viewer.tsx`: passes `onRotate` into the activity console, adds a **Save now** tile button with `saving` state, and flushes an overdue segment on `visibilitychange`.
  - `src/components/TopBar.tsx`: Records tab shows a count of live recordings so new saves are visible.
  - `src/styles/app.css`: `.rec-foot` wraps on narrow cards.
  - `src/lib/recorder.test.ts` (new): mocks MediaRecorder/IndexedDB via fake timers and asserts the auto-save timer, `flush()` and `stop()` each produce exactly one segment with the expected restart behavior.
  - `docs/03-viewer-and-clipping.md`: documents Save now, activity logging and background-tab flushing.
- **Decisions/rationale:** The recorder's timer path was verified in isolation, so the fix targets observability and the two realistic failure modes: a missing stop event and a throttled timer in a hidden tab. A manual flush also gives the owner a direct way to confirm the save pipeline.
- **Commands run & results:** `npm run build` passed (879 ms). `npm test` passed (7 files, 46 tests).
- **Graphify action:** `graphify update .` succeeded (572 nodes, 1689 edges, 16 communities).
- **Open issues/follow-ups:** Still unverified against a real live stream. If the activity console shows no "Saving … segment to Records" line when the interval elapses, the timer itself is not firing (background throttling); the visibility handler covers the return to the tab.

### 2026-11-18 — 1080p recording lag: root cause and fix
- **Intent/request:** "record stream in 1080p the video is laggy, do web search, read the code, find root cause and fix it".
- **Root cause:** `pickMime()` forced `video/webm;codecs=vp8,opus` for every recorder. Each tile runs two overlapping rolling recorders plus the continuous recorder, so 1080p capture meant three software VP8 encoders per stream competing with the HLS decoder. The HLS config also caught up at `maxLiveSyncPlaybackRate: 1.5`, adding 50% more frames to decode and encode per second.
- **Research findings (web search):** Chromium's MediaRecorder README states the browser picks a hardware-accelerated encoder when `mimeType` is omitted, and that hardware acceleration is used where possible. VP8 MediaRecorder is typically software-encoded; a 1080p60 raw frame is ~33 MB, so uncompressed throughput and encoder CPU dominate. hls.js docs describe `maxLiveSyncPlaybackRate` as a playback-rate catch-up lever, with 1.1 the common low-latency setting.
- **Changes (files + summary):**
  - `src/lib/recorder.ts`: `pickMime()` now probes H.264 WebM/MP4 first and returns `""` otherwise; new `recorderOptions()` omits `mimeType` when empty so the browser chooses its hardware codec, and `blobType()` reads the actual `rec.mimeType` back for saved blobs. `Running` and `LiveSession` store that resolved type. Removed the `!!pickMime()` gates in `canClip()` and the rolling recorder constructor. Continuous recorder bitrate 1.2 → 1.5 Mbps.
  - `src/screens/Viewer.tsx`: `maxLiveSyncPlaybackRate` 1.5 → 1.1.
  - `src/lib/recorder.test.ts`: fake recorder exposes `mimeType`.
  - `README.md`, `docs/03-viewer-and-clipping.md`: root-cause and tuning notes.
- **Decisions/rationale:** Leaving `mimeType` unset is intentional, not an oversight. It is the documented way to let Chrome select a hardware encoder; probing H.264 first covers browsers that need an explicit string. The saved blob uses `rec.mimeType`, so an MP4/H.264 recording is written with the right type and ffmpeg still detects the container during finalization.
- **Commands run & results:** `npm run build` passed (610 ms). `npm test` passed (7 files, 46 tests).
- **Graphify action:** `graphify update .` succeeded (574 nodes, 1694 edges, 23 communities).
- **Open issues/follow-ups:** No live 1080p stream available here, so the improvement is unverified on real hardware. If a machine has no hardware H.264 encoder, three recorders still fall back to software and a lower source resolution remains the only remedy. The activity console does not yet show which codec a recorder selected.

### 2026-11-18 — Recordings are raw captures: no auto-captions, no gallery chip
- **Intent/request:** "why saved recording have auto caption, it should not. Auto caption only for uploaded video, clips section, not recording sections"; then "why saved recording have recording indicator, fix it".
- **Changes (files + summary):**
  - `src/screens/Viewer.tsx`: removed the `autoCaptionClip` call from `saveSegment`. Continuous recordings no longer get word timings.
  - `src/store.tsx`: one-time migration (`clipkit.recordings.noAutoCaptions.v1`) clears `captions` from already-saved clips marked `recording`, leaving uploaded/manual clips untouched.
  - `src/screens/Recommend.tsx`: removed the `Recording` chip from saved gallery cards. The internal `recording` marker remains for routing only.
  - `src/styles/base.css`: removed the now-unused `.chip.recording` rule.
  - `src/screens/Settings.tsx` and docs/README: clarified that auto-captions apply to uploaded videos and Clips media only.
- **Decisions/rationale:** The Records gallery only holds recordings, so a permanent `Recording` chip was redundant and misleading after saving. Auto-captions belong to the Clips workflow. The migration is one-shot and only touches clips with `recording: true`.
- **Commands run & results:** `npm run build` passed (646 ms). `npm test` passed (7 files, 46 tests).
- **Graphify action:** `graphify update .` succeeded (574 nodes, 1694 edges, 23 communities).
- **Open issues/follow-ups:** Existing recordings lose their generated word timings on next app load. Captions generated manually in the Editor are project-level and unaffected.

### 2026-11-18 — Per-recording AI clip finder, Full HD recording, custom save interval
- **Intent/request:** "add find clip for each recording button like get clips with open in editor or play, find best clips from that video using AI, and improve the recording video quality in Full HD"; then "Auto-save recording every create more option with custom time step in drop down list".
- **Changes (files + summary):**
  - `src/lib/ai/findClips.ts` (new): shared `findClipsInMedia()` pipeline (poll media status, `/api/analyze`, `suggestClipsFromTranscript`, `/api/clip/cut`, store blob + thumb, `addClip`). Shared by the Clips screen and the new per-recording action.
  - `src/screens/Clips.tsx`: Clip Finder `run()` now delegates to the shared pipeline; removed duplicated imports.
  - `src/screens/Recommend.tsx`: **Find clips** button on every gallery card plus `FindRecordClipsModal`, which uploads the recording blob and runs the shared pipeline. Found clips go to Clips and can be opened in the Editor from the toast.
  - `src/lib/settings.ts`: `recordSaveSeconds` (number, 30–7200, default 300) replaces the fixed minute union, with a one-time migration from `recordSaveMinutes`; new `recordQuality: "fullhd" | "smooth"` (default fullhd).
  - `src/lib/recorder.ts`: `recordBitrate()` (4 Mbps fullhd, 1.5 Mbps smooth), bitrate injected into `RollingRecorder` and `LiveRecorder`.
  - `src/screens/Viewer.tsx`: uses seconds everywhere, passes bitrate by quality, drops `capLevelToPlayerSize` in Full HD, pins the highest HLS level ≤1080 while recording and restores auto (`currentLevel = -1`) on stop.
  - `src/screens/Settings.tsx`: interval dropdown with presets (30 s to 30 min) plus **Custom…** seconds field; Recording quality Seg.
  - `src/styles/app.css`: `.interval-ctl` / `.interval-custom`.
  - `src/lib/settings.test.ts`: updated for seconds, migration and clamping.
  - `README.md`, `docs/03-viewer-and-clipping.md`, `docs/10-recommend-mode.md`: documented all three changes.
- **Decisions/rationale:** One shared finder avoids two divergent AI pipelines. The custom interval is stored in seconds so presets and arbitrary values use one code path; the migration keeps old sessions. Full HD needs both a higher bitrate and a real HLS rendition because the old 2x2 surface forced the lowest ABR level; Smooth remains as the escape hatch for machines that stutter.
- **Commands run & results:** `npm run build` passed (652 ms). `npm test` passed (7 files, 47 tests).
- **Graphify action:** `graphify update .` succeeded (583 nodes, 1736 edges, 18 communities).
- **Open issues/follow-ups:** The per-recording finder uploads the whole recording to the local API and needs a downloaded caption model plus a configured AI endpoint. Forcing a fixed 1080p HLS level can stall on slow connections. None of this was exercised against a live stream here.

### 2026-11-19 — Records separation, auto finder defaults, recording smoothness, edit-entry cleanup
- **Intent/request:** (1) The Records tab showed clips that belong to Clips; it should list only videos recorded from a stream. (2) Extend the recording auto-save interval by another 30 minutes. (3) "Find clips" on a recording should run auto mode and save to Clips with a minimum score of 7. (4) Improve stream recording so it does not lag or buffer and keeps proper audio and video. (5) Opening the Editor should happen only from the edit icon, not other card controls.
- **Changes (files + summary):**
  - `src/screens/Recommend.tsx`: gallery now reads `clips.filter(c => c.recording && !c.removedAt)`, so manual clips, AI picks and imported media no longer appear in Records. Removed the grouped-card branch (recordings never carry `aiGroupId`) and the old reason parser. Card actions are a Preview thumbnail, an icon-only `Open in editor` button (the only editor entry), **Find clips** and Remove. `FindRecordClipsModal` now defaults to auto count/auto length and `minScore` 7, passes `autoCount`/`autoLength`, and its toast says the clips were saved to Clips.
  - `src/screens/Clips.tsx`: Clip Finder defaults its length fields to `Auto`, so one press runs fully automatic with the existing default score of 7. The card's Edit control is now an icon-only button (title/aria-label `Open in editor`); the thumbnail still opens preview. Cards grouped across streams show a `Moment in N streams` chip, preserving the clustering signal that used to live on the Records grouped card.
  - `src/lib/recorder.ts`: `LiveRecorder` now starts the next segment immediately after stopping the old recorder, before chunks are read back and the blob is written, so a save no longer leaves a recording gap. Rotations are serialised through a promise queue instead of a boolean guard, so a timer and a manual flush cannot drop a segment; near-empty queued rotations are ignored. Chunk timeslice 2 s → 4 s (fewer IndexedDB writes and blobs per segment) and audio 48 → 128 kbps.
  - `src/screens/Viewer.tsx`: Full HD now caps ABR with `hls.autoLevelCapping` instead of setting `hls.currentLevel` (which flushes the buffer and visibly stalls playback); the cap is released with `autoLevelCapping = -1` on stop. `startRecording` now depends on `settings.recordQuality` so a quality change is not captured from a stale closure.
  - `src/screens/Settings.tsx`: added a 60 min preset to Auto-save recording every (30 min was the previous maximum preset; custom still allows up to 2 hours).
  - `docs/03-viewer-and-clipping.md`, `docs/10-recommend-mode.md`: Records-only behavior, the 60 min preset, 4 s chunks, 128 kbps audio, the no-gap rotation, the ABR cap, and the auto/score-7 finder.
- **Decisions/rationale:** The two galleries are now strict partitions on the existing `Clip.recording` marker, with no new storage layer. Starting the next MediaRecorder synchronously on rotation is safe because each segment owns its own chunks and header, and it removes the gap that was caused by awaiting IndexedDB read-back. `autoLevelCapping` keeps ABR's ability to downshift, which is the correct lever for avoiding buffering on a weak connection, unlike `currentLevel` which forces a buffer flush. The requested "another 30 minutes" was implemented as a 60 min interval preset, the next step above 30 min; the 2 hour custom ceiling is unchanged.
- **Commands run & results:** `npm run typecheck` → passed. `npx vitest run` → 7 files / 47 tests passed. `npm run build` → passed (976 ms; pre-existing hls chunk-size warning).
- **Graphify action:** Not run in this session (graphify CLI unavailable here); source changes are limited to the listed files.
- **Open issues/follow-ups:** The rotation gap fix and the smoother HLS cap were not exercised against a live stream in this environment. Removed recordings are soft-removed and have no restore view (the bytes remain in IndexedDB). A 60 min segment still reads ~900 chunks back at save time; a streaming/remux path would be the next improvement if long segments show a delay.

### 2026-11-19 — Review pass: durable saves, correct AI model, smoother preview, stale capture
- **Intent/request:** Structured senior review of the recording/clip pipeline, fixing real correctness, performance and UX defects without changing external behavior.
- **Changes (files + summary):**
  - `src/lib/db.ts`: `tx()` resolved writes on the request's `success`, before the transaction committed, so a quota/disk abort was reported as a successful save and the clip was listed with missing bytes. Writes now resolve on `transaction.oncomplete` and reject on `error`/`abort`; reads still resolve on request success.
  - `src/screens/Viewer.tsx`: live AI transcription now calls `generateCaptionsForBlob(chunk, settings)`, so it honors the selected caption model and a configured NeMo endpoint instead of hardcoding `parakeet-tdt` and the local route. The playback effect clears `captureRef` on source change/reload so a later recording cannot reuse ended capture tracks.
  - `src/lib/ai/audioSample.ts`: removed the now-unused `transcribeAudioChunk()` (its base64 path duplicated the caption pipeline).
  - `src/components/ClipPreviewModal.tsx`: the caption overlay no longer calls `setState` with `currentTime` every animation frame. It tracks the active page/word and re-renders only when that changes, cutting idle re-renders from ~60/s to word rate with identical highlight behavior.
- **Decisions/rationale:** IndexedDB only guarantees durability at transaction completion; resolving per-request is the classic silent-data-loss bug. Reusing `generateCaptionsForBlob` removes a divergent duplicate path rather than adding a settings parameter to dead code. Word-level state is the smallest change that removes per-frame React work without altering caption timing. Clearing `captureRef` is the minimal reset; live recorders keep their own stream reference.
- **Commands run & results:** `npm run typecheck` → passed. `npx vitest run` → 7 files / 47 tests passed. `npm run build` → passed (675 ms; pre-existing hls chunk-size warning).
- **Graphify action:** Not run (graphify CLI unavailable in this environment).
- **Open issues/follow-ups:** The commit-safe write path and preview render reduction were not measured in a browser profile. A quota-abort test for `putBlob` would be a good unit addition. Live AI now depends on the multipart caption route, which is the same route auto-caption already uses.

### 2026-11-19 — Close out review follow-ups: restore view, bulk delete, chunk sweep
- **Intent/request:** "fix all" remaining findings from the review pass.
- **Changes (files + summary):**
  - `src/screens/Recommend.tsx`: added an All/Removed filter to the Records gallery. Removed recordings can be restored, deleted for good after confirmation, or removed in bulk via a Delete all confirm. Counts appear in the filter label.
  - `src/store.tsx`: new `deleteClips(ids)` performs one `setClips` update plus parallel blob/thumb deletion, so "Delete all" is O(n) instead of O(n²) with one render per clip. `clipsRef` also makes `deleteClip` stable across clip changes.
  - `src/screens/Clips.tsx`: Delete all now uses `deleteClips`.
  - `src/lib/db.ts`: new `deleteStaleRecordingChunks(maxAgeMs)`. `src/lib/recorder.ts` chunk keys now start with `rec:<startedAt base36>` so the sweep can skip recent chunks owned by another tab that is still recording; `StoreProvider` sweeps chunks older than 24 hours once at startup.
  - `docs/03-viewer-and-clipping.md`, `docs/10-recommend-mode.md`: documented the Removed filter and the chunk sweep.
- **Decisions/rationale:** Restore closes the trap created when Records became recording-only. The sweep's age guard avoids deleting a second tab's in-flight chunks, which a naive prefix sweep would do. Old-format `rec:` keys from earlier builds carry no timestamp and are left untouched rather than guessed at.
- **Commands run & results:** `npm run typecheck` → passed. `npx vitest run` → 7 files / 47 tests passed. `npm run build` → passed (644 ms; pre-existing hls chunk-size warning).
- **Graphify action:** Not run (graphify CLI unavailable here).
- **Open issues/follow-ups:** The Removed view, sweep and bulk delete were not exercised in a browser here. Pre-0.2 chunk keys without a timestamp remain orphaned until manually cleared; no data risk.

### 2026-11-19 — Phase 0/1: server split, server tests, screen error boundary
- **Intent/request:** Execute the approved architecture roadmap, starting with the safe Phase 0 hygiene and Phase 1 server decomposition.
- **Changes (files + summary):**
  - `server/lib/http.cjs` (new): json/fail/readBody/readJson/sendFile, `methodAndPath`, and a testable `parseRange`. Writes the same status codes and headers as before.
  - `server/lib/proc.cjs` (new): run/hasTool/encoderArgs/probe plus `nvencEnabled` and `ROOT`.
  - `server/lib/files.cjs` (new): cache paths, ensureCache, tempDir, mediaFile.
  - `server/lib/multipart.cjs` (new): streaming multipart parser and boundary parsing.
  - `server/lib/hls.cjs` (new): `isPlaylist` and `rewritePlaylist`, extracted from the stream proxy.
  - `server/lib/id.cjs`, `server/state.cjs` (new): shared id generator and the long-lived media/clip/model maps.
  - `server/services/media.cjs` (new): yt-dlp preparation and playable-format selection.
  - `server/routes/{health,streams,media,clips,ai,facecam,models,render-legacy}.cjs` (new): one route table per capability. Render/native-render/session endpoints are isolated in `render-legacy.cjs` for a later delete decision.
  - `server/router.cjs` (new): merges route tables into `"METHOD /path"` keys, preserves HEAD-as-GET and the `next()` fallback.
  - `server/index.cjs` (new): handler composition, static serving, standalone `start()`.
  - `server/dev-api.cjs`: reduced to the compatibility shim required by Vite and `npm run server`.
  - `server/lib/{http,hls,multipart}.test.cjs`, `server/router.test.cjs`, `server/services/media.test.cjs` (new): 12 `node:test` tests.
  - `package.json`: added `test:server`; `.github/workflows/ci.yml`: runs it after Vitest.
  - `src/components/ErrorBoundary.tsx` (new), `src/App.tsx`: separate boundaries for the persistent Viewer and the lazy screens, reset on screen change, so one crash keeps the shell and recordings alive.
  - `docs/02`, `docs/04`, `docs/05`, `docs/06`: corrected the stale external-server and server-render claims, documented the new module paths and test script.
- **Decisions/rationale:** Kept CommonJS and every URL/response byte-compatible; the shim means Vite, `npm run server`, and the legacy sibling fallback keep working. Route handlers are normalized to `(req, res, query)`; the first smoke run caught three handlers still on old positional signatures (health/models/media/render-abort), which were fixed before verification. Legacy render is isolated, not deleted, because docs/06 calls it unused but external callers were not ruled out.
- **Commands run & results:** `node --check` on every server file → OK. `npm run test:server` → 12/12 passed. Standalone smoke on port 5199: `/api/health` 200 with real tool flags, unknown path 404 JSON, model/media status 200, render abort 200, junk upload 415, invalid resolve 400. Vite middleware smoke on port 5198: `/api/health` 200 and app HTML 200. `npm run typecheck` passed. `npm test` → 7 files / 47 tests passed. `npm run build` → passed (647 ms; pre-existing hls chunk-size warning).
- **Graphify action:** Not run (graphify CLI unavailable here).
- **Open issues/follow-ups:** Phase 2 (Viewer capture hooks), Phase 3 (typed API client and single clip-finder form), Phase 4 (store domain providers), and Phase 5 (storage repositories) remain. `/api/render*` still exists and is still documented as unused; delete it only after confirming no external caller. The new UI error boundary was not exercised in a browser here.

### 2026-11-19 — Phases 2–5: Viewer feature split, typed API, library context, storage repositories
- **Intent/request:** "do all" — execute the remaining architecture roadmap phases without changing the stack, API contracts or user-facing behavior.
- **Changes (files + summary):**
  - `src/platform/api/{client,models,streams,media,ai}.ts` (new): typed boundary over `fetch`. `client.ts` owns `apiFetch`/`apiJson`/`apiPostJson`/`apiBlob`, `ApiError` and the server's nested `error.message`. Settings, Viewer, Clips, Recommend, finder modals and the OpenAI proxy now call it; `src/lib/ai/models.ts`, `src/lib/ai/streamResolve.ts` and `src/lib/clipFinalize.ts` were deleted.
  - `src/features/ai-clips/ClipFinderFields.tsx` (new): one form, defaults, resolver and validation for both finder modals; `Clips` and `Recommend` now share `DEFAULT_CLIP_FINDER` (auto mode, score 7).
  - `src/features/viewer/`: `StreamCard.tsx` (playback, rolling/live recording, manual and AI clips, ~580 lines), `ActivityLog.tsx`, `useAiAutoClip.ts` (interval pass, clustering, grouped saves) and `types.ts` (`TileApi`). `src/screens/Viewer.tsx` is now composition plus the add-stream/resolve flow (~250 lines).
  - `src/platform/storage/keys.ts` (new): every `localStorage` key and one-shot migration flag. `src/lib/settings.ts`, `src/store.tsx` and `src/screens/Viewer.tsx` use it.
  - `src/platform/storage/migrations.ts` (new): `once(key, run)` only writes the flag after the migration returns, so a throw is retried next load.
  - `src/platform/storage/clipRepository.ts` (new): validated `loadClips`/`saveClips`. `src/store.tsx` loads clips synchronously, saves through the repository on a 250 ms debounce and flushes on `pagehide`; `deleteClips` stays O(n).
  - `src/store.tsx`: new `LibraryStore`/`useLibrary()` context holding `clips`, `addClip`, `updateClip`, `deleteClip`, `deleteClips`, `autoCaptionClip`; those fields were removed from `Store`. `ViewerStore` picks the library methods it needs. Consumers migrated: `TopBar`, `Clips`, `Recommend`, `Editor` empty state, `Settings` storage stats.
  - `docs/02-architecture.md`, `docs/09-live-streams.md`, `AGENT.md`: updated module paths, storage ownership and the HLS catch-up rate.
- **Decisions/rationale:** Compatibility first: same URLs, payloads, visible behavior and CommonJS server. Splitting the 908-line Viewer around its existing effects keeps each capture path byte-identical while giving the AI loop and card separate homes. A single library context (rather than separate project/templates providers) removes the highest-frequency writes first; a full domain split can follow without touching consumers again. Debouncing the clip array avoids a full `localStorage` rewrite per note keystroke, and the repository filters malformed entries instead of trusting stored JSON.
- **Commands run & results:** `npm run typecheck` → passed. `npm test -- --run` → 7 files / 47 tests passed. `npm run test:server` → 12/12 passed. `npm run build` → passed (745 ms; only the pre-existing hls chunk-size warning).
- **Graphify action:** Not run (graphify CLI unavailable here).
- **Open issues/follow-ups:** Live playback, recording, AI clipping and the split Viewer were not exercised in a browser here (no live source). Phase 6 (CSS decomposition) was intentionally left out. `/api/render*` remains isolated and undeleted pending confirmation that no external caller exists.

### 2026-11-19 — Stricter clip rules for stream recordings
- **Intent/request:** Finding clips in a stream recording must save at most 4 clips, require a score above 7, and accept a single qualifying clip.
- **Changes (files + summary):**
  - `src/features/ai-clips/ClipFinderFields.tsx`: added `RECORDING_MAX_CLIPS` (4), `RECORDING_MIN_SCORE` (8), `RECORDING_CLIP_LIMITS`, `RECORDING_CLIP_FINDER`, and an optional `limits` argument/prop. The recording form now defaults to 4 / 8, hides larger count and lower score options, and `clipFinderOptions` clamps any value that slips through.
  - `src/lib/ai/findClips.ts`: new pure `selectClipPicks(picks, minScore, maxClips)` applies the score gate then the hard cap, including the full-video fallback. One pick is a valid result.
  - `src/screens/Recommend.tsx`: the per-recording finder uses the recording preset, limits and an explicit 4 / 8+ description.
  - `src/features/ai-clips/ClipFinderFields.test.ts` (new): 8 tests for defaults, clamping, auto mode, the untouched general finder, score filtering, a single qualifying clip, the 4-clip cap and the empty case.
  - `docs/10-recommend-mode.md`: documented the recording-specific rules.
- **Decisions/rationale:** "More than 7" is implemented as an 8+ floor because scores are integers. The limit is enforced in two places: the form only offers allowed values, and the pipeline clamps anyway so an older stored form value or another caller cannot exceed it. The general Clips upload finder keeps its existing options; only jobs on saved stream recordings are stricter.
- **Commands run & results:** `npm run typecheck` → passed. `npm test -- --run` → 8 files / 55 tests passed (the new 8 included). `npm run build` → passed.
- **Graphify action:** Not run (graphify CLI unavailable here).
- **Open issues/follow-ups:** The rules were not exercised against a real long recording or a live AI model here. The Viewer's AI auto-clip path is separate and already saves at most one clip per stream per pass.

### 2026-11-20 — Custom AI model input + Test connection fixes
- **Intent/request:** User showed two failing "Test connection" results (Gemini model `gemini-3.1-flash-lite` → "high demand"; Kilo `kc/kilo-auto/free` → "AI returned no content") and asked to allow custom model input and fix it.
- **Changes (files + summary):**
  - `src/screens/Settings.tsx`: the Gemini model `<select>` became a free-text `<input>` with a `<datalist>` of the two known models, so any model name can be typed for every profile. Overload errors now append "Try a different model above."
  - `src/lib/ai/openai.ts`: new `replyText()`/`asText()` accept content-part arrays, `output_text`, legacy `text`, `response`/`result`, and reasoning-only replies; upstream `error` objects are surfaced even on HTTP 200; non-JSON and empty replies get actionable messages (including `finish_reason`), both for the AI Studio proxy and direct endpoints.
  - `server/lib/gemini.cjs`: `resolveGeminiModel()` keeps any custom non-deprecated name instead of silently replacing it; `generateWithFallback()` now retries the *other* built-in model on transient overload, including when `gemini-3.1-flash-lite` itself is the failing model.
  - `src/lib/ai/openai.test.ts`: 5 new tests for the response shapes and error paths; `server/lib/gemini.test.cjs` (new): custom-name retention and retired-name replacement.
- **Decisions/rationale:** The fixed two-option dropdown was the only profile without a text field, so a datalist keeps the suggestions while removing the restriction. Reading only `message.content` as a string is the root of "AI returned no content" on gateway-style responses; preferring the final answer fields and using reasoning only as a last resort avoids feeding chain-of-thought into clip scoring while still giving a visible reply. Server-side name validation had to be relaxed or a typed custom model would be silently discarded. The fallback change is symmetric so the fast model being overloaded no longer ends the retry chain.
- **Commands run & results:** `npm.cmd run typecheck` → passed. `npm.cmd test -- --run` → 8 files / 65 tests passed. `npm.cmd run test:server` → 14/14 passed. `npm.cmd run build` → passed (pre-existing hls chunk-size warning).
- **Graphify action:** `graphify update .` → rebuilt (790 nodes, 2406 edges, 20 communities; CLI 0.9.102 older than the 0.9.109 skill, no LLM relabeling).
- **Open issues/follow-ups:** No live endpoint available here to confirm which exact response shape Kilo/Colab returns, so the fix is shape-tolerant rather than provider-specific. If a gateway still returns empty content with `finish_reason: length`, the error now names the reason and the user can switch models or lower the prompt size. Custom Gemini names are passed to `@google/genai` verbatim, so an invalid name surfaces the provider's own error.

### 2026-11-20 — Copy post text icon on clip cards + auto middle text in Editor
- **Intent/request:** User showed the clip card's action icons and asked for an easy "post text" copy icon on the tile, with that copied text automatically placed on the video; clarified via question: copy the AI caption + hashtags, and auto-add only that copied text as middle-of-video text in the Editor (no separate FULL VIDEO CTA preset).
- **Changes (files + summary):**
  - `src/lib/project.ts`: new `postCopyText(clip)` (caption line + hashtags line) and `postTextItem(clip)` (center text layer spanning the whole clip, 44px TikTok font, white on black background).
  - `src/screens/Clips.tsx`: new Copy icon button on each clip card action row (shown when the clip has AI post copy), writes the text to the clipboard with a success/error toast.
  - `src/components/ClipPreviewModal.tsx`: its existing Copy button now uses the same shared helper.
  - `src/store.tsx`: `openClip` now adds `postTextItem(clip)` as a text layer whenever a clip has AI post copy, in addition to the existing preview-only overlay caption and optional 3s hook.
  - `src/lib/project.test.ts`: 4 new tests for the copy format, empty cases and the middle text layer geometry.
- **Decisions/rationale:** One shared helper keeps the card copy, modal copy and auto text identical. The text layer is centered (`x/y` 0.5), spans `0..duration-in`, and uses a background instead of a stroke so long hashtag lines stay readable, matching the phone-preview style in the user's screenshot. The earlier `applyViralHook` option is untouched; the new text is independent of it.
- **Commands run & results:** `npm.cmd run typecheck` → passed (after replacing a partial `Clip` cast in the new test with a full fixture). `npm.cmd test -- --run` → 8 files / 69 tests passed. `npm.cmd run build` → passed (pre-existing hls chunk-size warning).
- **Graphify action:** `graphify update .` → run after the change set.
- **Open issues/follow-ups:** Clipboard writes require a secure context; the code already reports failures as a toast. The auto text is burned into renders; clips without AI viral data are unchanged. Not exercised in a browser here.

### 2026-11-20 — On-video text is now a short hook (6 words, one emoji)
- **Intent/request:** "in here only hook text max 6 word with single emoji" — replace the auto-added post caption on the tile with the hook, capped at six words and exactly one emoji.
- **Changes (files + summary):**
  - `src/lib/project.ts`: new `hookTileText(clip)` strips extra emoji, keeps the first one (or 🔥), uppercases and truncates the hook to six words; `hookTextItem(clip)` replaces `postTextItem(clip)` and uses it for the centered full-clip text layer. `postCopyText(clip)` is kept for the copy icon and preview overlay.
  - `src/store.tsx`: `openClip` now burns `hookTextItem(clip)` into the middle of the video; the preview-only overlay still carries caption + hashtags and the optional 3s hook button is unchanged.
  - `src/lib/project.test.ts`: tests for the six-word cap, single-emoji dedupe, text-layer geometry, and empty cases.
- **Decisions/rationale:** Truncating locally means older clips (whose stored hooks may be longer or emoji-free) get the same short on-screen text without regenerating with AI. Keeping the first existing emoji preserves the model's intent; 🔥 is the fallback when there is none. The clipboard copy remains caption + hashtags as the user previously chose, so only the on-video text changed.
- **Commands run & results:** `npm.cmd run typecheck` → passed. `npm.cmd test -- --run` → 8 files / 71 tests passed (one test expectation corrected from 3 to 4 words). `npm.cmd run build` → passed (pre-existing hls chunk-size warning).
- **Graphify action:** `graphify update .` → run after the change set.
- **Open issues/follow-ups:** The emoji set is the Unicode Extended_Pictographic range, so symbol-like characters count as emoji. Not exercised in a browser here.

### Template for future entries
- **Date/time/session:**
- **Intent/request:**
- **Changes (files + summary):**
- **Decisions/rationale:**
- **Commands run & results:**
- **Graphify action:** (built/updated? query used?)
- **Open issues/follow-ups:**
