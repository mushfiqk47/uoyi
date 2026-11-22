# Graph Report - clipweave-web (2)  (2026-11-23)

## Corpus Check
- 133 files · ~108,304 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: .woff2 4, .ttf 3, .css 2)

## Summary
- 1039 nodes · 3273 edges · 35 communities (34 shown, 1 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 136 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f30877ec`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- proc.cjs
- uid
- package.json
- lib/types.ts
- Settings.tsx
- useStreamRecorder.ts
- router.cjs
- store.tsx
- findClips.ts
- compilerOptions
- steps
- facecam_detect.py
- render.cjs
- vitest
- json
- gemini.cjs
- streamlink.cjs
- ai.cjs
- compositor.ts
- audiocpp.cjs
- Clips.tsx
- StreamCard.tsx
- scripts
- tools.cjs
- state.cjs
- openai.ts
- dependencies
- vite.config.ts
- settings.ts
- ref_node_assert
- security.cjs
- ass.cjs
- feedback.ts
- index.cjs
- hls.test.cjs

## God Nodes (most connected - your core abstractions)
1. `json()` - 46 edges
2. `useStore()` - 46 edges
3. `run()` - 38 edges
4. `StoreProvider()` - 34 edges
5. `fail()` - 33 edges
6. `EditorWorkspace()` - 33 edges
7. `uid()` - 32 edges
8. `react` - 31 edges
9. `Project` - 28 edges
10. `useStreamRecorder()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `apiNativeAbort()` --calls--> `json()`  [EXTRACTED]
  server/routes/render.cjs → server/lib/http.cjs
- `apiSceneDetectCancel()` --calls--> `json()`  [EXTRACTED]
  server/routes/scenedetect.cjs → server/lib/http.cjs
- `apiSceneDetectStatus()` --calls--> `json()`  [EXTRACTED]
  server/routes/scenedetect.cjs → server/lib/http.cjs
- `apiStreamlinkCancel()` --calls--> `json()`  [EXTRACTED]
  server/routes/streamlink.cjs → server/lib/http.cjs
- `pipInstall()` --calls--> `run()`  [EXTRACTED]
  server/lib/tools.cjs → server/lib/proc.cjs

## Import Cycles
- None detected.

## Communities (35 total, 1 thin omitted)

### Community 0 - "proc.cjs"
Cohesion: 0.09
Nodes (26): fs, LOCAL_TOOLS, path, ROOT, { spawn }, detectScenesFfmpeg(), fs, fsp (+18 more)

### Community 1 - "uid"
Cohesion: 0.26
Nodes (9): blobToBase64(), CaptionClipRange, generateCaptionsForBlob(), GeneratedCaptions, mapRawWordsToClipRanges(), wordsFromData(), parseSubtitles(), parseTime() (+1 more)

### Community 2 - "package.json"
Cohesion: 0.17
Nodes (15): devDependencies, @types/node@^26.6.6, @types/react@^19.3.0, @types/react-dom@^19.3.0, typescript@^7.0.2, vite@^8.3.8, name, private (+7 more)

### Community 3 - "lib/types.ts"
Cohesion: 0.06
Nodes (80): lucide-react, react, ColorField(), Field(), NumberInput(), Range(), Seg(), Switch() (+72 more)

### Community 4 - "Settings.tsx"
Cohesion: 0.09
Nodes (38): AutoTextarea(), FindClipsParams, putBlob(), canPickFolder(), clearRenderFolder(), DirHandle, getRenderFolder(), pickRenderFolder() (+30 more)

### Community 5 - "useStreamRecorder.ts"
Cohesion: 0.06
Nodes (41): loadSavedRecId(), saveRecId(), useStreamRecorder(), deleteBlob(), forgetUrl(), blobType(), CapturableVideo, captureTracks() (+33 more)

### Community 6 - "router.cjs"
Cohesion: 0.29
Nodes (9): start(), methodAndPath(), handle(), match(), route(), ROUTES, TABLES, assert (+1 more)

### Community 7 - "store.tsx"
Cohesion: 0.13
Nodes (25): Toasts(), deleteStaleRecordingChunks(), lookOf(), saveSettings(), loadJson(), saveJson(), setJsonSaveErrorHandler(), isClip() (+17 more)

### Community 8 - "findClips.ts"
Cohesion: 0.06
Nodes (61): hls.js, CaptionModelSetup(), ClipFinderLimits, DEFAULT_CLIP_FINDER, RECORDING_CLIP_FINDER, RECORDING_CLIP_LIMITS, RECORDING_MAX_CLIPS, RECORDING_MIN_SCORE (+53 more)

### Community 9 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, jsx, lib, module, moduleResolution, noEmit, noUnusedLocals (+6 more)

### Community 10 - "steps"
Cohesion: 0.17
Nodes (11): runs-on, steps, jobs, check, name, on, run, uses (+3 more)

### Community 11 - "facecam_detect.py"
Cohesion: 0.29
Nodes (3): decode(), embedding(), main()

### Community 12 - "render.cjs"
Cohesion: 0.10
Nodes (27): clampNumber(), filterPath(), fs, fsp, parseRange(), readBody(), sendFile(), streamFileToResponse() (+19 more)

### Community 14 - "json"
Cohesion: 0.14
Nodes (29): fail(), json(), readJson(), validateExternalHttpUrl(), installerFor(), apiChat(), apiClipCut(), apiFacecam() (+21 more)

### Community 15 - "gemini.cjs"
Cohesion: 0.14
Nodes (21): analyzeMediaWithGemini(), chatWithGemini(), DEPRECATED_MODELS, detectFacecamWithGemini(), distributeWordsOverRange(), formatGeminiError(), fsp, generateWithFallback() (+13 more)

### Community 16 - "streamlink.cjs"
Cohesion: 0.09
Nodes (30): ensureCache(), mediaFile(), crypto, probe(), apiUpload(), fs, fsp, path (+22 more)

### Community 17 - "ai.cjs"
Cohesion: 0.20
Nodes (27): modelInstalled(), resolveCli(), tempDir(), hasGeminiKey(), encoderArgs(), findOpenCvPython(), findScenedetect(), findStreamlink() (+19 more)

### Community 18 - "compositor.ts"
Cohesion: 0.06
Nodes (50): captionPages(), drawBlurredBackdrop(), drawCaptions(), drawContain(), drawCover(), drawFrame(), drawOverlay(), drawTextItem() (+42 more)

### Community 19 - "audiocpp.cjs"
Cohesion: 0.09
Nodes (35): audioCppRoot(), binDir(), catalogEntries(), downloadModel(), ensureRuntime(), extractRuntime(), fs, fsp (+27 more)

### Community 20 - "Clips.tsx"
Cohesion: 0.06
Nodes (63): App(), Clips, Editor, Queue, Recommend, Settings, Shell(), ClipPreviewModal() (+55 more)

### Community 21 - "StreamCard.tsx"
Cohesion: 0.15
Nodes (16): StreamCard, TileApi, Toast, useAiAutoClip(), useAudioMonitor(), recordAudioChunk(), MomentVerdict, ViralClipSuggestion (+8 more)

### Community 22 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, dev, lint, nemo:gpu, preview, server, share (+5 more)

### Community 23 - "tools.cjs"
Cohesion: 0.14
Nodes (20): downloadFile(), extractZipNode(), findFileInTree(), fs, fsp, INSTALLERS, installFfmpeg(), installFfmpegLinux() (+12 more)

### Community 24 - "state.cjs"
Cohesion: 0.15
Nodes (19): CACHE, cacheStats(), dirSizeBytes(), fsp, MODELS_FILE, path, sweepCacheDir(), apiCacheInfo() (+11 more)

### Community 25 - "openai.ts"
Cohesion: 0.20
Nodes (18): AiSettings, asText(), baseHeaders(), chatCompletion(), ChatMessage, clamp10(), ClipFinderOptions, clusterMoments() (+10 more)

### Community 26 - "dependencies"
Cohesion: 0.17
Nodes (8): dependencies, @google/genai@^3.6.1, hls.js@^1.7.4, lucide-react@^1.74.0, react@^19.3.1, react-dom@^19.3.1, @google/genai, react-dom

### Community 27 - "vite.config.ts"
Cohesion: 0.40
Nodes (4): @vitejs/plugin-react@^6.3.0, @vitejs/plugin-react, configureServer(), require

### Community 28 - "settings.ts"
Cohesion: 0.16
Nodes (18): ACCENTS, AiProfile, applyAppearance(), BACKGROUNDS, ButtonStyle, DEFAULT_SETTINGS, fingerprint(), hexToRgb() (+10 more)

### Community 29 - "ref_node_assert"
Cohesion: 0.15
Nodes (7): assert, { test }, assert, { Readable, Writable }, { test }, assert, { test }

### Community 30 - "security.cjs"
Cohesion: 0.19
Nodes (9): BLOCKED_HOSTNAMES, ipv4ToInt(), isPrivateIp(), isPrivateIpv4(), net, path, assert, path (+1 more)

### Community 31 - "ass.cjs"
Cohesion: 0.29
Nodes (10): assColor(), assFontName(), assText(), assTime(), buildOverlayAssContent(), fsp, path, assert (+2 more)

### Community 32 - "feedback.ts"
Cohesion: 0.32
Nodes (10): ClipFeedbackAction, emptyStats(), FeedbackEntry, FeedbackStats, feedbackSummary(), loadFeedbackStats(), recompute(), recordClipFeedback() (+2 more)

### Community 33 - "index.cjs"
Cohesion: 0.22
Nodes (6): fs, http, path, serveStatic(), STATIC_TYPES, safeResolvedPath()

### Community 34 - "hls.test.cjs"
Cohesion: 0.47
Nodes (4): isPlaylist(), rewritePlaylist(), assert, { test }

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `lib/types.ts` to `package.json`, `Settings.tsx`, `useStreamRecorder.ts`, `store.tsx`, `findClips.ts`, `Clips.tsx`, `StreamCard.tsx`, `dependencies`?**
  _High betweenness centrality (0.253) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `StoreProvider()` (e.g. with `loadSettings()` and `loadClips()`) actually correct?**
  _`StoreProvider()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `proc.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08912655971479501 - nodes in this community are weakly interconnected._
- **Why does `vite` connect `package.json` to `vite.config.ts`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **Should `lib/types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06307369525308157 - nodes in this community are weakly interconnected._
- **Why does `@vitejs/plugin-react` connect `vite.config.ts` to `package.json`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **Should `Settings.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0927536231884058 - nodes in this community are weakly interconnected._