# Graph Report - clipweave-web  (2026-11-20)

## Corpus Check
- 99 files · ~81,516 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: .woff2 5, .ttf 2, .css 2)

## Summary
- 793 nodes · 2427 edges · 31 communities (29 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 72 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- compositor.ts
- uid
- package.json
- panels.tsx
- Settings.tsx
- recorder.ts
- http.cjs
- store.tsx
- openai.ts
- compilerOptions
- steps
- facecam_detect.py
- render-legacy.cjs
- vitest
- streams.cjs
- gemini.cjs
- routes/media.cjs
- ai.cjs
- util.ts
- json
- App.tsx
- Viewer.tsx
- scripts
- StreamCard.tsx
- activity.ts
- LiveRecorder
- dependencies
- vite.config.ts
- viewer/types.ts
- FakeRecorder
- streams.ts

## God Nodes (most connected - your core abstractions)
1. `useStore()` - 41 edges
2. `json()` - 33 edges
3. `StoreProvider()` - 32 edges
4. `uid()` - 31 edges
5. `fail()` - 30 edges
6. `StreamCard` - 30 edges
7. `EditorWorkspace()` - 28 edges
8. `Store` - 25 edges
9. `run()` - 23 edges
10. `react` - 23 edges

## Surprising Connections (you probably didn't know these)
- `apiMediaStatus()` --calls--> `json()`  [EXTRACTED]
  server/routes/media.cjs → server/lib/http.cjs
- `cloneLook()` --calls--> `uid()`  [EXTRACTED]
  src/lib/project.ts → src/lib/util.ts
- `newProject()` --calls--> `uid()`  [EXTRACTED]
  src/lib/project.ts → src/lib/util.ts
- `CaptionsPanel()` --calls--> `projectDuration()`  [EXTRACTED]
  src/editor/panels.tsx → src/lib/project.ts
- `TextPanel()` --calls--> `projectDuration()`  [EXTRACTED]
  src/editor/panels.tsx → src/lib/project.ts

## Import Cycles
- None detected.

## Communities (31 total, 2 thin omitted)

### Community 0 - "compositor.ts"
Cohesion: 0.09
Nodes (31): Clock, Player, PREVIEW_H, PREVIEW_W, useClock(), usePlayer(), captionPages(), drawBlurredBackdrop() (+23 more)

### Community 1 - "uid"
Cohesion: 0.38
Nodes (8): blobToBase64(), generateCaptionsForBlob(), GeneratedCaptions, wordsFromData(), parseSubtitles(), parseTime(), CaptionWord, uid()

### Community 2 - "package.json"
Cohesion: 0.19
Nodes (13): devDependencies, @types/node@^26.6.6, @types/react@^19.3.0, @types/react-dom@^19.3.0, typescript@^7.0.2, name, private, type (+5 more)

### Community 3 - "panels.tsx"
Cohesion: 0.08
Nodes (70): lucide-react, react, ClipPreviewModal(), ClipThumb(), Onboarding(), steps(), TABS, TopBar() (+62 more)

### Community 4 - "Settings.tsx"
Cohesion: 0.14
Nodes (26): AutoTextarea(), canPickFolder(), clearRenderFolder(), DirHandle, getRenderFolder(), pickRenderFolder(), saveRenderToFolder(), ACCENTS (+18 more)

### Community 5 - "recorder.ts"
Cohesion: 0.14
Nodes (10): blobType(), CapturableVideo, Chunk, LiveRecorderOptions, LiveSegment, LiveSession, recorderOptions(), Recording (+2 more)

### Community 6 - "http.cjs"
Cohesion: 0.12
Nodes (18): fs, http, path, serveStatic(), start(), STATIC_TYPES, fs, fsp (+10 more)

### Community 7 - "store.tsx"
Cohesion: 0.05
Nodes (67): FindClipsParams, FrameInput, deleteStaleRecordingChunks(), ActiveClip, cloneLook(), DEFAULT_CAPTION_STYLE, DEFAULT_LAYOUT, DEFAULT_OVERLAY (+59 more)

### Community 8 - "openai.ts"
Cohesion: 0.08
Nodes (43): ClipPick, findClipsInMedia(), FindClipsOptions, PreparedMedia, selectClipPicks(), AiSettings, asText(), baseHeaders() (+35 more)

### Community 9 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, jsx, lib, module, moduleResolution, noEmit, noUnusedLocals (+6 more)

### Community 10 - "steps"
Cohesion: 0.17
Nodes (11): runs-on, steps, jobs, check, name, on, run, uses (+3 more)

### Community 11 - "facecam_detect.py"
Cohesion: 0.29
Nodes (3): decode(), embedding(), main()

### Community 12 - "render-legacy.cjs"
Cohesion: 0.14
Nodes (31): fail(), sendFile(), boundaryOf(), readMultipart(), apiClipFinalize(), serveClip(), serveMedia(), apiNativeRender() (+23 more)

### Community 13 - "vitest"
Cohesion: 0.25
Nodes (6): vitest@^5.1.0, vitest, blobs, FakeOptions, recorders, stream

### Community 14 - "streams.cjs"
Cohesion: 0.18
Nodes (10): apiResolve(), http, https, SEGMENT_CACHE, titleFromDirectUrl(), detectDirectMedia(), isDirectMediaUrl(), pickPlayable() (+2 more)

### Community 15 - "gemini.cjs"
Cohesion: 0.08
Nodes (29): analyzeMediaWithGemini(), chatWithGemini(), DEPRECATED_MODELS, detectFacecamWithGemini(), distributeWordsOverRange(), formatGeminiError(), fsp, generateWithFallback() (+21 more)

### Community 16 - "routes/media.cjs"
Cohesion: 0.11
Nodes (23): CACHE, ensureCache(), fsp, mediaFile(), path, crypto, id(), ROOT (+15 more)

### Community 17 - "ai.cjs"
Cohesion: 0.15
Nodes (28): tempDir(), hasGeminiKey(), readJson(), encoderArgs(), findOpenCvPython(), hasTool(), nvencEnabled(), path (+20 more)

### Community 18 - "util.ts"
Cohesion: 0.06
Nodes (58): frameReady(), Visual, blobUrl(), clearBlobs(), deleteBlob(), forgetUrl(), getBlob(), open() (+50 more)

### Community 19 - "json"
Cohesion: 0.21
Nodes (10): MODELS_FILE, json(), apiModelDownload(), apiModels(), apiModelStatus(), availableModels(), fsp, apiNativeAbort() (+2 more)

### Community 20 - "App.tsx"
Cohesion: 0.13
Nodes (12): App(), Clips, Editor, Queue, Recommend, Settings, Shell(), ErrorBoundary (+4 more)

### Community 21 - "Viewer.tsx"
Cohesion: 0.24
Nodes (11): Toast, useAiAutoClip(), logActivity(), captures, registerCaptureStream(), releaseCaptureStream(), canClip(), Stream (+3 more)

### Community 22 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, dev, lint, nemo:gpu, preview, server, share (+5 more)

### Community 23 - "StreamCard.tsx"
Cohesion: 0.29
Nodes (8): hls.js, StreamCard, recordAudioChunk(), getCaptureStream(), captureTracks(), captureVideo(), recordBitrate(), finalizeClipBlob()

### Community 24 - "activity.ts"
Cohesion: 0.29
Nodes (9): ActivityLog(), ActivityEntry, ActivityTone, clearActivity(), emit(), entries, getActivity(), listeners (+1 more)

### Community 26 - "dependencies"
Cohesion: 0.25
Nodes (8): dependencies, @google/genai@^3.6.1, hls.js@^1.7.4, lucide-react@^1.74.0, react@^19.3.1, react-dom@^19.3.1, @google/genai, react-dom

### Community 27 - "vite.config.ts"
Cohesion: 0.29
Nodes (6): vite@^8.3.8, @vitejs/plugin-react@^6.3.0, vite, @vitejs/plugin-react, configureServer(), require

### Community 28 - "viewer/types.ts"
Cohesion: 0.36
Nodes (4): TileApi, MomentVerdict, ViralClipSuggestion, ViralDetails

### Community 30 - "streams.ts"
Cohesion: 0.60
Nodes (4): directPlayable(), platformOf(), ResolvedStream, resolveStreamInput()

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `panels.tsx` to `compositor.ts`, `package.json`, `Settings.tsx`, `store.tsx`, `util.ts`, `App.tsx`, `Viewer.tsx`, `StreamCard.tsx`, `activity.ts`, `dependencies`?**
  _High betweenness centrality (0.207) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `StoreProvider()` (e.g. with `loadSettings()` and `loadClips()`) actually correct?**
  _`StoreProvider()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `compositor.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08637873754152824 - nodes in this community are weakly interconnected._
- **Why does `vite` connect `vite.config.ts` to `package.json`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Should `panels.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.077715934858792 - nodes in this community are weakly interconnected._
- **Why does `@vitejs/plugin-react` connect `vite.config.ts` to `package.json`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Should `Settings.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.1425287356321839 - nodes in this community are weakly interconnected._