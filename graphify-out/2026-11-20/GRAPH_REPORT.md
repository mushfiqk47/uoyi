# Graph Report - clipweave-web  (2026-11-20)

## Corpus Check
- 99 files · ~81,090 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: .woff2 5, .ttf 2, .css 2)

## Summary
- 792 nodes · 2423 edges · 19 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 72 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- compositor.ts
- panels.tsx
- package.json
- Clips.tsx
- Settings.tsx
- StreamCard.tsx
- http.cjs
- store.tsx
- openai.ts
- compilerOptions
- steps
- facecam_detect.py
- render-legacy.cjs
- recorder.test.ts
- streams.cjs
- gemini.cjs
- routes/media.cjs
- ai.cjs
- json

## God Nodes (most connected - your core abstractions)
1. `useStore()` - 41 edges
2. `json()` - 33 edges
3. `StoreProvider()` - 31 edges
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
- `apiNativeAbort()` --calls--> `json()`  [EXTRACTED]
  server/routes/render-legacy.cjs → server/lib/http.cjs
- `cloneLook()` --calls--> `uid()`  [EXTRACTED]
  src/lib/project.ts → src/lib/util.ts
- `newProject()` --calls--> `uid()`  [EXTRACTED]
  src/lib/project.ts → src/lib/util.ts
- `usePlayer()` --calls--> `projectDuration()`  [EXTRACTED]
  src/editor/player.ts → src/lib/project.ts

## Import Cycles
- None detected.

## Communities (19 total, 0 thin omitted)

### Community 0 - "compositor.ts"
Cohesion: 0.06
Nodes (52): Clock, Player, PREVIEW_H, PREVIEW_W, usePlayer(), drawBlurredBackdrop(), drawCaptions(), drawContain() (+44 more)

### Community 1 - "panels.tsx"
Cohesion: 0.07
Nodes (57): ColorField(), Field(), NumberInput(), Range(), Switch(), CaptionsPanel(), ClipPanel(), FacecamPicker() (+49 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (41): dependencies, @google/genai@^3.6.1, hls.js@^1.7.4, lucide-react@^1.74.0, react@^19.3.1, react-dom@^19.3.1, devDependencies, @types/node@^26.6.6 (+33 more)

### Community 3 - "Clips.tsx"
Cohesion: 0.08
Nodes (61): lucide-react, react, App(), Clips, Editor, Queue, Recommend, Settings (+53 more)

### Community 4 - "Settings.tsx"
Cohesion: 0.07
Nodes (48): AutoTextarea(), clearBlobs(), deleteBlob(), deleteStaleRecordingChunks(), forgetUrl(), open(), openFresh(), putBlob() (+40 more)

### Community 5 - "StreamCard.tsx"
Cohesion: 0.05
Nodes (49): hls.js, ActivityLog(), StreamCard, TileApi, Toast, useAiAutoClip(), ActivityEntry, ActivityTone (+41 more)

### Community 6 - "http.cjs"
Cohesion: 0.16
Nodes (14): fs, http, path, serveStatic(), start(), STATIC_TYPES, methodAndPath(), handle() (+6 more)

### Community 7 - "store.tsx"
Cohesion: 0.06
Nodes (62): vitest, FindClipsParams, AiSettings, asText(), baseHeaders(), chatCompletion(), ChatMessage, clamp10() (+54 more)

### Community 8 - "openai.ts"
Cohesion: 0.09
Nodes (33): ClipFinderLimits, DEFAULT_CLIP_FINDER, RECORDING_CLIP_FINDER, RECORDING_CLIP_LIMITS, RECORDING_MAX_CLIPS, RECORDING_MIN_SCORE, ClipPick, findClipsInMedia() (+25 more)

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
Cohesion: 0.12
Nodes (37): tempDir(), fail(), sendFile(), boundaryOf(), readMultipart(), apiClipCut(), apiClipFinalize(), serveClip() (+29 more)

### Community 13 - "recorder.test.ts"
Cohesion: 0.20
Nodes (5): blobs, FakeOptions, FakeRecorder, recorders, stream

### Community 14 - "streams.cjs"
Cohesion: 0.28
Nodes (6): apiResolve(), http, https, SEGMENT_CACHE, titleFromDirectUrl(), pickPlayable()

### Community 15 - "gemini.cjs"
Cohesion: 0.07
Nodes (31): analyzeMediaWithGemini(), chatWithGemini(), DEPRECATED_MODELS, detectFacecamWithGemini(), distributeWordsOverRange(), formatGeminiError(), fsp, generateWithFallback() (+23 more)

### Community 16 - "routes/media.cjs"
Cohesion: 0.10
Nodes (26): CACHE, ensureCache(), fsp, mediaFile(), MODELS_FILE, path, crypto, id() (+18 more)

### Community 17 - "ai.cjs"
Cohesion: 0.23
Nodes (18): encoderArgs(), findOpenCvPython(), hasTool(), nvencEnabled(), path, probe(), run(), { spawn } (+10 more)

### Community 19 - "json"
Cohesion: 0.15
Nodes (17): hasGeminiKey(), fs, fsp, json(), parseRange(), readBody(), readJson(), apiChat() (+9 more)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Clips.tsx` to `compositor.ts`, `panels.tsx`, `package.json`, `Settings.tsx`, `StreamCard.tsx`, `store.tsx`?**
  _High betweenness centrality (0.208) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `StoreProvider()` (e.g. with `loadSettings()` and `loadClips()`) actually correct?**
  _`StoreProvider()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `compositor.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05755693581780538 - nodes in this community are weakly interconnected._
- **Should `panels.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06817513958272113 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05053191489361702 - nodes in this community are weakly interconnected._
- **Should `Clips.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07545787545787545 - nodes in this community are weakly interconnected._
- **Should `Settings.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06830601092896176 - nodes in this community are weakly interconnected._