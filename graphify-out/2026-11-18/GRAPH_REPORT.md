# Graph Report - clipweave-web  (2026-11-18)

## Corpus Check
- 57 files · ~62,677 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: .woff2 5, .onnx 2, .ttf 2)

## Summary
- 574 nodes · 1694 edges · 23 communities (20 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `48afa293`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- store.tsx
- types.ts
- package.json
- store.tsx
- main.tsx
- Viewer.tsx
- dev-api.cjs
- panels.tsx
- scripts
- compilerOptions
- steps
- facecam_detect.py
- util.ts
- vitest
- vite.config.ts
- FakeRecorder
- openai.ts
- recorder.ts
- LiveRecorder
- RollingRecorder
- activity.ts
- TileApi
- resolveStreamInput

## God Nodes (most connected - your core abstractions)
1. `useStore()` - 39 edges
2. `Store` - 30 edges
3. `uid()` - 29 edges
4. `EditorWorkspace()` - 28 edges
5. `BackgroundStream` - 26 edges
6. `route()` - 26 edges
7. `StoreProvider()` - 25 edges
8. `fmtTime()` - 21 edges
9. `Project` - 20 edges
10. `fail()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `GeneratedCaptions` --references--> `CaptionWord`  [EXTRACTED]
  src/lib/ai/captions.ts → src/lib/types.ts
- `CardModel` --references--> `Clip`  [EXTRACTED]
  src/screens/Recommend.tsx → src/lib/types.ts
- `AiSettings()` --calls--> `chatCompletion()`  [EXTRACTED]
  src/screens/Settings.tsx → src/lib/ai/openai.ts
- `AiSettings()` --calls--> `tryParseJson()`  [EXTRACTED]
  src/screens/Settings.tsx → src/lib/ai/openai.ts
- `Data()` --calls--> `clearBlobs()`  [EXTRACTED]
  src/screens/Settings.tsx → src/lib/db.ts

## Import Cycles
- None detected.

## Communities (23 total, 3 thin omitted)

### Community 0 - "store.tsx"
Cohesion: 0.10
Nodes (29): blobUrl(), clearBlobs(), deleteBlob(), forgetUrl(), getBlob(), open(), openFresh(), putBlob() (+21 more)

### Community 1 - "types.ts"
Cohesion: 0.05
Nodes (67): Clock, Player, PREVIEW_H, PREVIEW_W, useClock(), usePlayer(), keyNudge(), Lane() (+59 more)

### Community 2 - "package.json"
Cohesion: 0.17
Nodes (15): devDependencies, @types/node@^26.6.6, @types/react@^19.3.0, @types/react-dom@^19.3.0, typescript@^7.0.2, vite@^8.3.8, name, private (+7 more)

### Community 3 - "store.tsx"
Cohesion: 0.06
Nodes (59): App(), Clips, Editor, Queue, Recommend, Settings, Shell(), Toasts() (+51 more)

### Community 4 - "main.tsx"
Cohesion: 0.20
Nodes (6): dependencies, hls.js@^1.7.4, lucide-react@^1.74.0, react@^19.3.1, react-dom@^19.3.1, react-dom

### Community 5 - "Viewer.tsx"
Cohesion: 0.18
Nodes (15): hls.js, getActivity(), logActivity(), subscribeActivity(), recordAudioChunk(), transcribeAudioChunk(), finalizeClip(), FinalizedClip (+7 more)

### Community 6 - "dev-api.cjs"
Cohesion: 0.06
Nodes (75): apiAnalyze(), apiCaptions(), apiChat(), apiClipCut(), apiClipFinalize(), apiFacecam(), apiHealth(), apiMediaPrepare() (+67 more)

### Community 7 - "panels.tsx"
Cohesion: 0.08
Nodes (61): lucide-react, react, ClipPreviewModal(), ClipThumb(), Onboarding(), steps(), AutoTextarea(), ColorField() (+53 more)

### Community 8 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, nemo:gpu, preview, server, share, test (+2 more)

### Community 9 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, jsx, lib, module, moduleResolution, noEmit, noUnusedLocals (+6 more)

### Community 10 - "steps"
Cohesion: 0.17
Nodes (11): runs-on, steps, jobs, check, name, on, run, uses (+3 more)

### Community 11 - "facecam_detect.py"
Cohesion: 0.29
Nodes (3): decode(), embedding(), main()

### Community 12 - "util.ts"
Cohesion: 0.23
Nodes (11): QueueJob, downloadBlob(), fmtBytes(), fmtCount(), fmtDuration(), safeFileName(), JobCard(), Queue() (+3 more)

### Community 13 - "vitest"
Cohesion: 0.25
Nodes (6): vitest@^5.1.0, vitest, blobs, FakeOptions, recorders, stream

### Community 14 - "vite.config.ts"
Cohesion: 0.33
Nodes (4): @vitejs/plugin-react@^6.3.0, @vitejs/plugin-react, configureServer(), require

### Community 16 - "openai.ts"
Cohesion: 0.29
Nodes (11): AiSettings, baseHeaders(), chatCompletion(), ChatMessage, ClipFinderOptions, clusterMoments(), judgeMoment(), suggestClipsFromTranscript() (+3 more)

### Community 17 - "recorder.ts"
Cohesion: 0.20
Nodes (10): CapturableVideo, captureTracks(), captureVideo(), Chunk, hintForMotion(), LiveRecorderOptions, LiveSegment, LiveSession (+2 more)

### Community 18 - "LiveRecorder"
Cohesion: 0.27
Nodes (3): blobType(), LiveRecorder, recorderOptions()

### Community 20 - "activity.ts"
Cohesion: 0.33
Nodes (6): ActivityEntry, ActivityTone, clearActivity(), emit(), entries, listeners

### Community 22 - "resolveStreamInput"
Cohesion: 0.60
Nodes (4): directPlayable(), platformOf(), ResolvedStream, resolveStreamInput()

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `panels.tsx` to `store.tsx`, `types.ts`, `package.json`, `store.tsx`, `main.tsx`, `Viewer.tsx`, `util.ts`?**
  _High betweenness centrality (0.166) - this node is a cross-community bridge._
- **Should `store.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.10099573257467995 - nodes in this community are weakly interconnected._
- **Why does `@vitejs/plugin-react` connect `vite.config.ts` to `package.json`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.050615901455767075 - nodes in this community are weakly interconnected._
- **Why does `vite` connect `package.json` to `vite.config.ts`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Should `store.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.059676044330775786 - nodes in this community are weakly interconnected._
- **Should `dev-api.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06442577030812324 - nodes in this community are weakly interconnected._