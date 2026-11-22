# 09 — Live streaming: latency and stutter

Why a "live" view can feel laggy, what Clipweave does about it, and what it cannot fix, because
the floor is set by the broadcaster's segmenting, not by the player.

## What Clipweave does

Player configuration (`src/features/viewer/StreamCard.tsx`):

- `liveSyncDurationCount: 2` — play at the live edge target of 2 segments instead of hls.js's default 3.
- `liveMaxLatencyDurationCount: 6` — beyond 6 segments behind the edge, consider the stream stalled.
- `maxLiveSyncPlaybackRate: 1.1` — when behind the edge, catch up at up to 1.1× so the view
  stops drifting further behind real time without the extra decode cost of a faster chase.
- `lowLatencyMode` — hls.js enables LL-HLS handling by default (partial segments, blocking playlist
  reloads, rendition reports). Clipweave passes the origin's query strings through the proxy
  unchanged, so blocking reloads (`_HLS_msn` / `_HLS_part`) still work for LL-capable origins.
- `capLevelToPlayerSize: true` — small tiles get small renditions.
- `backBufferLength: 10`, `maxBufferLength: 15`, `maxMaxBufferLength: 30` — bounded buffers keep
  demux and memory pressure down when several streams play at once.
- Rolling recorders encode at 2 Mbps each; the AI sample pipeline reuses the same capture.

## What you cannot fix locally

- Segment size is the latency floor. Six-second segments mean roughly 2×6 s of unavoidable delay,
  no matter the player.
- YouTube live is typically 15–30 s behind real time; Twitch and Kick are lower (Twitch's
  low-latency mode gets close to 1–3 s, but only if the channel broadcasts in that mode).
- Every stream goes through the same-origin proxy (`/stream?url=…`, `server/dev-api.cjs`) for CORS
  safety. Blocking playlist reloads and partial segments survive the rewrite, but the proxy adds
  one hop of latency versus a direct origin fetch.
- N simultaneous HD decodes are bounded by the machine's decoder budget. Small tiles at low ABR
  levels are the mitigation; there is no client-side trick that removes it.

## Practical guidance

- If a live stream feels behind, it is almost always the platform's segment cadence — check the
  stream in a second tab to confirm.
- For the lowest latency, use a low-latency-enabled source (Twitch channel with low latency mode).
- If a stream stutters, lower its quality in the tile's quality picker; `capLevelToPlayerSize`
  helps automatically but cannot override a manually pinned level.

Research note (2026-11-18): the general web search returned no results at the time of writing;
the tuning above was taken from the installed hls.js release's own documentation and source
(defaults: `lowLatencyMode: true`, `backBufferLength: Infinity`, `liveSyncDurationCount: 3`), so
only options present and typed in this version are used. Sources:

- hls.js repository README and docs (LL-HLS support, `liveSyncDurationCount`, blocking reloads):
  https://github.com/video-dev/hls.js
- HLS RFC 8216bis (LL tags: `EXT-X-PART`, `EXT-X-PRELOAD-HINT`, `EXT-X-SERVER-CONTROL`):
  https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis
