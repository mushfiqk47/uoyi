"use strict";

// audio.cpp (github.com/0xShug0/audio.cpp) integration: local runtime + GGUF provisioning
// and word-timestamped ASR transcription. This is what makes the Caption-model
// "Download & use" button work on a fresh machine: the button provisions BOTH the
// runtime and the model into an app-owned folder, and the server invokes the CLI by
// absolute path, so nothing depends on PATH or a shell restart.
//
// Layout: the runtime lives under <repo>/transcript (env CLIPWEAVE_AUDIOCPP_DIR overrides);
// model GGUFs are stored in the repo's existing models/ folder next to the other model files
// (env CLIPWEAVE_AUDIOCPP_MODELS overrides):
//   <repo>/transcript/bin/audiocpp_cli.exe   portable runtime, self-contained
//   <repo>/models/<modelId>/<file>.gguf      downloaded model packages
// Fresh installs fetch the LATEST prebuilt CPU portable zip from GitHub releases (falling
// back to the tested pinned version when the release API is unreachable); existing installs
// are never auto-upgraded mid-session. CUDA/Vulkan builds are opt-in via CLIPWEAVE_AUDIOCPP_URL.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const { run, ROOT } = require("./proc.cjs");

const AUDIOCPP_VERSION = "v0.9.6";
const RELEASE_BASE = "https://github.com/0xShug0/audio.cpp/releases";
const HF_BASE = "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main";
const RUNTIME_ZIP =
  process.env.CLIPWEAVE_AUDIOCPP_URL ||
  `${RELEASE_BASE}/download/${AUDIOCPP_VERSION}/audio-${AUDIOCPP_VERSION}-bin-windows-x64-cpu-portable.zip`;
const BACKEND = process.env.CLIPWEAVE_AUDIOCPP_BACKEND || "cpu";

// App catalog id -> audio.cpp GGUF package. Every downloadable single-file ASR GGUF the
// pinned audio.cpp release supports (from its bundled model_specs, sizes verified against
// the Hugging Face trees). Families without a published GGUF (edda, audio8 — convert-only)
// and multi-file packages (LFM2.5/LFM3 Audio, Nemotron 30B, VibeVoice BitNet) are excluded.
// Catalog entries without a package here (parakeet-ctc, nemotron-en) are still served
// through nemo-speech when installed.
function gguf(dir, file) {
  return { file, url: `${HF_BASE}/${dir}/${file}` };
}
function hf(repo, file) {
  return { file, url: `https://huggingface.co/${repo}/resolve/main/${file}` };
}

const PACKAGES = {
  "parakeet-tdt": {
    family: "parakeet_tdt",
    label: "Parakeet TDT 0.6B v3",
    ...gguf("Parakeet-TDT-0.6B-v3-GGUF", "parakeet-tdt-0.6b-v3-q8_0.gguf"),
    bytes: 915735760,
    langs: 25,
    wordTimes: true,
    note: "Fast multilingual European ASR — best default for captions.",
  },
  "qwen3-asr": {
    family: "qwen3_asr",
    label: "Qwen3-ASR 1.7B",
    ...gguf("Qwen3-ASR-1.7B-GGUF", "qwen3-asr-1.7b-q8_0.gguf"),
    bytes: 2473566208,
    langs: 31,
    wordTimes: true,
    note: "Strong multilingual accuracy with word timestamps.",
  },
  "crisperwhisper-2": {
    family: "crisperwhisper",
    label: "CrisperWhisper 2.0 Large",
    ...gguf("CrisperWhisper2.0-GGUF", "crisperwhisper-2-large-q8_0.gguf"),
    bytes: 1716572160,
    langs: 99,
    wordTimes: true,
    note: "Whisper-family with precise word-level timing, 99 languages.",
  },
  "sensevoice-small": {
    family: "sense_asr",
    label: "SenseVoice Small",
    ...hf("FunAudioLLM/SenseVoiceSmall-GGUF-audiocpp", "sensevoice-small-q8-audiocpp-v1.gguf"),
    bytes: 253755392,
    langs: 23,
    wordTimes: true,
    note: "Compact multilingual model, strong on zh/en/ja/ko.",
  },
  "nemotron-3.5": {
    family: "nemotron_asr",
    label: "Nemotron 3.5 ASR 0.6B",
    ...gguf("Nemotron-3.5-ASR-Streaming-0.6B-GGUF", "nemotron-3.5-asr-streaming-0.6b-q8_0.gguf"),
    bytes: 930625888,
    langs: 40,
    wordTimes: false,
    note: "NVIDIA streaming ASR, 40 languages.",
  },
  "cohere-transcribe": {
    family: "cohere_asr",
    label: "Cohere Transcribe",
    ...gguf("Cohere-Transcribe-GGUF", "cohere-transcribe-03-2026-bf16.gguf"),
    bytes: 4134529024,
    langs: 14,
    wordTimes: false,
    note: "Large high-quality transcription model.",
  },
  "voxtral-realtime": {
    family: "voxtral_realtime",
    label: "Voxtral Mini 4B Realtime",
    ...gguf("Voxtral-Mini-4B-Realtime-2602-GGUF", "voxtral-mini-4b-realtime-2602-q8_0.gguf"),
    bytes: 5105565696,
    langs: 13,
    wordTimes: false,
    note: "Realtime-capable multilingual ASR.",
  },
  "canary-180m-flash": {
    family: "canary_asr",
    label: "Canary 180M Flash",
    ...gguf("Canary-180M-Flash-GGUF", "canary-180m-flash-f32.gguf"),
    bytes: 758120448,
    langs: 4,
    wordTimes: false,
    note: "Tiny fast en/de/es/fr model.",
  },
  "granite5asr": {
    family: "granite5asr",
    label: "Granite Speech 5.0 470M TurboCTC",
    ...gguf("Granite-Speech-5.0-470M-TurboCTC-GGUF", "granite-speech-5.0-470m-turboctc-q8_0.gguf"),
    bytes: 504365056,
    langs: 7,
    wordTimes: true,
    note: "IBM compact English-focused ASR with word timestamps.",
  },
  "gigaam-v3": {
    family: "gigaam_asr",
    label: "GigaAM v3 CTC",
    ...gguf("GigaAM-ASR-GGUF", "gigaam-v3-ctc-f16.gguf"),
    bytes: 441452544,
    langs: 5,
    wordTimes: true,
    note: "Russian-focused ASR with word timestamps.",
  },
  "owsm-v4": {
    family: "owsm",
    label: "OWSM v4 Base",
    ...gguf("OWSM-GGUF", "owsm-v4-base-102m-f32.gguf"),
    bytes: 331350016,
    langs: 151,
    wordTimes: false,
    note: "Wide language coverage (151), compact.",
  },
  "owsm-ctc-1b": {
    family: "owsm_ctc",
    label: "OWSM-CTC v4 1B",
    ...gguf("OWSM-CTC-GGUF", "owsm-ctc-v4-1b-f32.gguf"),
    bytes: 4046311424,
    langs: 151,
    wordTimes: false,
    note: "Larger OWSM for 151 languages.",
  },
  "granite-speech-2b": {
    family: "granite_speech5",
    label: "Granite Speech 5.0 2B",
    ...gguf("Granite-Speech-5.0-2B-GGUF", "granite-speech-5.0-2b-q8_0.gguf"),
    bytes: 3296411648,
    langs: 6,
    wordTimes: false,
    note: "IBM 2B ASR/translation model.",
  },
  "moonshine-streaming": {
    family: "moonshine_asr",
    label: "Moonshine Streaming Tiny",
    ...gguf("Moonshine-Streaming-GGUF", "moonshine-streaming-tiny-q8_0.gguf"),
    bytes: 60817408,
    langs: 1,
    wordTimes: false,
    note: "Tiny English streaming model (58 MB).",
  },
  // "citrinet" removed 2026-11-23: Hugging Face replaced the GGUF with bytes that CLI
  // v0.9.6 rejects ("SparseMelFilterbank metadata range mismatch"); re-add once upstream
  // publishes a compatible build.
  "kroko-en": {
    family: "kroko_asr",
    label: "Kroko Community ASR",
    ...gguf("Kroko-ASR-GGUF", "kroko-en-community-64-l-q8_0.gguf"),
    bytes: 167772160,
    langs: 10,
    wordTimes: true,
    note: "Community English model with word timestamps.",
  },
  "niagara-en": {
    family: "niagara_asr",
    label: "Niagara 19M Batch",
    ...gguf("Niagara-ASR-GGUF", "niagara-19m-batch.en-f32.gguf"),
    bytes: 255852544,
    langs: 1,
    wordTimes: false,
    note: "Very small English model.",
  },
  "samsone": {
    family: "samsone",
    label: "SAMSONE 99M",
    ...gguf("Samsone-GGUF", "samsone-99m-bf16.gguf"),
    bytes: 201326592,
    langs: 1,
    wordTimes: false,
    note: "Compact community English model.",
  },
  "whistle": {
    family: "whistle_asr",
    label: "Whistle ASR",
    ...gguf("Whistle-GGUF", "whistle-f32.gguf"),
    bytes: 221249536,
    langs: 7,
    wordTimes: false,
    note: "Experimental multilingual model.",
  },
  "haas-ja": {
    family: "haas_asr",
    label: "Haas-ja v1.0",
    ...gguf("Haas-ja-v1.0-GGUF", "haas-ja-v1.0-q8_0.gguf"),
    bytes: 880803840,
    langs: 1,
    wordTimes: true,
    note: "Japanese ASR with word timestamps.",
  },
  "phonon-2": {
    family: "phonon2_asr",
    label: "Phonon-2",
    ...gguf("Phonon-2-GGUF", "phonon-2-mixed-q8.gguf"),
    bytes: 1184371712,
    langs: 1,
    wordTimes: true,
    note: "Community model with word timestamps.",
  },
  "underdog-bark3": {
    family: "underdog_bark3",
    label: "Underdog Bark 3",
    ...gguf("Underdog-Bark-3.0-GGUF", "underdog-bark-3.0-mixed-f16.gguf"),
    bytes: 1301339136,
    langs: 1,
    wordTimes: true,
    note: "Community fine-tune with word timestamps.",
  },
  "moss-diarize": {
    family: "moss_transcribe_diarize",
    label: "MOSS-Transcribe-Diarize",
    ...gguf("MOSS-Transcribe-Diarize-GGUF", "moss-transcribe-diarize-bf16.gguf"),
    bytes: 1832910848,
    langs: 2,
    wordTimes: false,
    note: "Transcription with speaker diarization.",
  },
  "vibevoice-asr": {
    family: "vibevoice_asr",
    label: "VibeVoice ASR 7B",
    ...gguf("VibeVoice-ASR-GGUF", "vibevoice-asr-q8_0.gguf"),
    bytes: 9856614400,
    langs: 2,
    wordTimes: false,
    note: "Large ASR model (9.4 GB download).",
  },
  "vibevoice-asr-streaming": {
    family: "vibevoice_asr_streaming",
    label: "VibeVoice ASR Streaming 7B",
    ...gguf("VibeVoice-ASR-Streaming-7B-GGUF", "vibevoice-asr-streaming-7b-q8_0.gguf"),
    bytes: 9856614400,
    langs: 10,
    wordTimes: false,
    note: "Large streaming ASR (9.4 GB download).",
  },
  "higgs-stt": {
    family: "higgs_audio_stt",
    label: "Higgs Audio v3 STT",
    ...gguf("Higgs-Audio-v3-STT-GGUF", "higgs-audio-v3-stt-q8_0.gguf"),
    bytes: 3158372352,
    langs: 1,
    wordTimes: false,
    note: "Audio-LLM based English transcription.",
  },
  "hviske-v6": {
    family: "hviske_asr_v6",
    label: "Hviske v6",
    ...gguf("Hviske-v6-GGUF", "hviske-v6-bf16.gguf"),
    bytes: 2803865600,
    langs: 1,
    wordTimes: false,
    note: "Danish-focused ASR.",
  },
  "confucius4-r2t2": {
    family: "confucius4_r2t2",
    label: "Confucius4 R2T2",
    ...hf("davidxifeng/Confucius4-R2T2-gguf", "r2t2-q8_0.gguf"),
    bytes: 2477465600,
    langs: 30,
    wordTimes: false,
    note: "Community Chinese/multilingual ASR.",
  },
  "fun-asr-nano": {
    family: "fun_asr_nano",
    label: "Fun-ASR-Nano 2512",
    ...gguf("Fun-ASR-Nano-2512-GGUF", "fun-asr-nano-2512-q8_0.gguf"),
    bytes: 1045433344,
    langs: 4,
    wordTimes: false,
    note: "Work-in-progress multilingual model.",
  },
  "audio-flamingo-next": {
    family: "audio_flamingo",
    label: "Audio Flamingo Next",
    ...hf("audio-cpp/Audio-Flamingo-GGUF", "audio-flamingo-next-q4_k.gguf"),
    bytes: 5454471168,
    langs: 1,
    wordTimes: false,
    note: "Audio-LLM transcription (5.2 GB download).",
  },
  "ming3-audio-tiny": {
    family: "ming3_audio",
    label: "Ming 3.0 Audio Tiny",
    ...hf("audio-cpp/Ming-3.0-Audio-Tiny-GGUF", "ming-3.0-audio-tiny-bf16.gguf"),
    bytes: 20175830016,
    langs: 2,
    wordTimes: false,
    note: "Audio-LLM; very large download (~19 GB).",
  },
  "index-echo-s2tt": {
    family: "index_echo",
    label: "Index-Echo S2TT 2B",
    ...hf("audio-cpp/Index-Echo-S2TT-GGUF", "index-echo-s2tt-2b-orig.gguf"),
    bytes: 5106565120,
    langs: 4,
    wordTimes: false,
    note: "Speech-to-text translation, experimental.",
  },
};

function audioCppRoot() {
  if (process.env.CLIPWEAVE_AUDIOCPP_DIR) return process.env.CLIPWEAVE_AUDIOCPP_DIR;
  return path.join(ROOT, "transcript");
}

function modelsRoot() {
  if (process.env.CLIPWEAVE_AUDIOCPP_MODELS) return process.env.CLIPWEAVE_AUDIOCPP_MODELS;
  return path.join(ROOT, "models");
}

function binDir() {
  return path.join(audioCppRoot(), "bin");
}

function modelDir(modelId) {
  return path.join(modelsRoot(), String(modelId || ""));
}

/** Resolve the audiocpp_cli executable by absolute path, then PATH. Returns {exe, version} or null. */
let cliCache;
async function resolveCli() {
  if (cliCache !== undefined) return cliCache;
  const candidates = [];
  if (process.env.CLIPWEAVE_AUDIOCPP_EXE) candidates.push(process.env.CLIPWEAVE_AUDIOCPP_EXE);
  const exe = process.platform === "win32" ? "audiocpp_cli.exe" : "audiocpp_cli";
  candidates.push(path.join(binDir(), exe));
  candidates.push(exe); // found on PATH when someone installed audio.cpp themselves
  for (const candidate of candidates) {
    const r = await run(candidate, ["--version"], { timeout: 10000 });
    if (r.code === 0) {
      const m = String(r.stdout || "").match(/audio\.cpp\s+(\S+)/);
      cliCache = { exe: candidate, version: m ? m[1] : "" };
      return cliCache;
    }
  }
  cliCache = null;
  return null;
}

/** Streams url to dest with a .part sidecar; onProgress(percent, received, total). */
async function downloadFile(url, dest, onProgress = () => {}) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  const tmp = `${dest}.part`;
  const ws = fs.createWriteStream(tmp);
  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      if (!ws.write(chunk)) await once(ws, "drain");
      onProgress(total ? Math.min(99, Math.round((received / total) * 100)) : 0, received, total);
    }
    await new Promise((resolve, reject) => ws.end((err) => (err ? reject(err) : resolve())));
    if (total > 0 && received !== total) throw new Error(`incomplete download: ${received} of ${total} bytes`);
    await fsp.rename(tmp, dest);
    onProgress(100, received, total || received);
  } finally {
    ws.destroy();
    fsp.rm(`${dest}.part`, { force: true }).catch(() => {});
  }
}

/** Cheap zip sanity check: the End-of-Central-Directory record must exist near the file tail. */
async function zipLooksValid(zipPath) {
  try {
    const st = await fsp.stat(zipPath);
    if (st.size < 22) return false;
    const readLen = Math.min(st.size, 65580);
    const fh = await fsp.open(zipPath, "r");
    try {
      const { buffer } = await fh.read(Buffer.alloc(readLen), 0, readLen, st.size - readLen);
      for (let i = buffer.length - 22; i >= 0; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) return true;
      }
      return false;
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

/**
 * Pure-Node zip extractor (stored + deflate entries, no external tools). Used as the last
 * extraction fallback so a missing/blocked tar.exe or PowerShell can never block setup.
 */
function extractZipNode(zipPath, destDir) {
  const zlib = require("node:zlib");
  const resolvedDest = path.resolve(destDir);
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no zip end-of-central-directory record found");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    const outPath = path.resolve(destDir, name);
    const rel = path.relative(resolvedDest, outPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`unsafe zip path: ${name}`);
    if (name.endsWith("/") || name.endsWith("\\")) {
      fs.mkdirSync(outPath, { recursive: true });
      continue;
    }
    const lhNameLen = buf.readUInt16LE(lho + 26);
    const lhExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lhNameLen + lhExtraLen;
    if (dataStart + compSize > buf.length) throw new Error(`truncated zip entry: ${name}`);
    const data = buf.subarray(dataStart, dataStart + compSize);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (method === 0) fs.writeFileSync(outPath, data);
    else if (method === 8) fs.writeFileSync(outPath, zlib.inflateRawSync(data));
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);
  }
  return count;
}

/** PowerShell string literal: single quotes with embedded quotes doubled. */
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * Extracts the portable zip into <root>/bin, trying every mechanism in order so a fresh
 * machine always succeeds: Windows' bundled bsdtar (handles zip), PowerShell
 * Expand-Archive (paths safely quoted), then a pure-Node extractor with no dependencies.
 */
async function extractRuntime(zipPath, onLog = () => {}) {
  const root = audioCppRoot();
  const bin = binDir();
  const tmp = path.join(root, `.extract-${Date.now()}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    const errors = [];
    let extracted = false;
    const tarExe = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
    if (process.platform !== "win32" || fs.existsSync(tarExe)) {
      const r = await run(tarExe, ["-xf", zipPath, "-C", tmp], { timeout: 600000 });
      if (r.code === 0) {
        extracted = true;
        onLog("Extracted runtime (tar).");
      } else {
        errors.push(`tar: ${String(r.stderr || r.stdout || "failed").trim().split("\n").slice(-1)[0] || "exit " + r.code}`);
      }
    } else {
      errors.push("tar: not found");
    }

    if (!extracted && process.platform === "win32") {
      const cmd = `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(tmp)} -Force`;
      const r = await run("powershell", ["-NoProfile", "-Command", cmd], { timeout: 600000 });
      if (r.code === 0) {
        extracted = true;
        onLog("Extracted runtime (PowerShell).");
      } else {
        errors.push(`Expand-Archive: ${String(r.stderr || r.stdout || "failed").trim().split("\n").slice(-1)[0] || "exit " + r.code}`);
      }
    }

    if (!extracted && process.platform === "win32") {
      try {
        const n = extractZipNode(zipPath, tmp);
        extracted = true;
        onLog(`Extracted runtime (built-in extractor, ${n} entries).`);
      } catch (e) {
        errors.push(`built-in extractor: ${String(e.message || e)}`);
      }
    }

    if (!extracted) {
      throw new Error(`Could not extract the runtime archive. Tried: ${errors.join("; ")}`);
    }

    // The zip is usually flat, but find the directory holding the CLI in case packaging changes.
    const exeName = process.platform === "win32" ? "audiocpp_cli.exe" : "audiocpp_cli";
    let srcDir = null;
    if (fs.existsSync(path.join(tmp, exeName))) {
      srcDir = tmp;
    } else {
      const stack = [tmp];
      while (stack.length && !srcDir) {
        const dir = stack.pop();
        for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
          else if (entry.name === exeName) srcDir = dir;
        }
      }
    }
    if (!srcDir) throw new Error("Runtime archive did not contain audiocpp_cli.");
    await fsp.mkdir(bin, { recursive: true });
    for (const entry of await fsp.readdir(srcDir, { withFileTypes: true })) {
      await fsp.cp(path.join(srcDir, entry.name), path.join(bin, entry.name), { recursive: true });
    }
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Prebuilt runtime asset base names for a machine (release assets carry an `audio-<tag>-` prefix). */
function runtimeAssetCandidates(platform = process.platform, arch = process.arch) {
  if (platform === "win32") return ["bin-windows-x64-cpu-portable.zip"];
  if (platform === "darwin") {
    return [arch === "arm64" ? "bin-macos-arm64-metal.tar.gz" : "bin-macos-x64-metal.tar.gz"];
  }
  if (arch === "arm64") return ["bin-ubuntu-arm64-cpu-portable.tar.gz", "bin-ubuntu-x64-cpu-portable.tar.gz"];
  return ["bin-ubuntu-x64-cpu-portable.tar.gz"];
}

/** Resolves the newest prebuilt runtime for this OS/arch from GitHub releases, falling back to the pinned tested Windows version. */
async function latestRuntime() {
  const wanted = runtimeAssetCandidates();
  try {
    const res = await fetch("https://api.github.com/repos/0xShug0/audio.cpp/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "clipweave-local-api" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const assets = (data.assets || []).map((a) => String(a.name || ""));
    const assetName = wanted.find((base) => assets.some((n) => n.endsWith(base)));
    if (!assetName) throw new Error(`no prebuilt runtime asset for ${process.platform}/${process.arch} in the latest release`);
    const asset = (data.assets || []).find((a) => String(a.name || "").endsWith(assetName));
    return { url: asset.browser_download_url, tag: data.tag_name || "latest" };
  } catch (e) {
    if (process.platform !== "win32") throw new Error(`No prebuilt audio.cpp runtime could be resolved for ${process.platform}/${process.arch}: ${String(e.message || e)}`);
    return { url: RUNTIME_ZIP, tag: AUDIOCPP_VERSION };
  }
}

let runtimePromise = null;
/** Downloads + extracts the latest prebuilt runtime when no CLI is resolvable yet.
 *  The zip is validated before extraction and the download retried once, so an
 *  interrupted transfer can never wedge the setup with a corrupt archive. */
function ensureRuntime(onLog = () => {}) {
  runtimePromise = runtimePromise || (async () => {
    const found = await resolveCli();
    if (found) return found;
    const root = audioCppRoot();
    await fsp.mkdir(root, { recursive: true });
    const { url, tag } = await latestRuntime();
    const zipPath = path.join(root, `audiocpp-${tag}.zip`);
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        onLog(attempt === 1 ? `Downloading audio.cpp runtime ${tag} (~35 MB)…` : "Download looked broken — retrying…", 0);
        await downloadFile(url, zipPath, (pct) => onLog(`Downloading runtime… ${pct}%`, pct));
        if (!(await zipLooksValid(zipPath))) throw new Error("downloaded archive is incomplete or corrupt");
        onLog("Extracting runtime…");
        await extractRuntime(zipPath, onLog);
        fsp.rm(zipPath, { force: true }).catch(() => {});
        lastError = null;
        break;
      } catch (e) {
        lastError = String(e.message || e);
        onLog(`Runtime setup problem: ${lastError}`);
        fsp.rm(zipPath, { force: true }).catch(() => {});
      }
    }
    if (lastError) throw new Error(lastError);
    cliCache = undefined;
    const found2 = await resolveCli();
    if (!found2) throw new Error("Runtime installed but audiocpp_cli did not run.");
    onLog(`audio.cpp ${found2.version} ready.`);
    return found2;
  })().catch((e) => {
    runtimePromise = null;
    throw e;
  });
  return runtimePromise;
}

function packageFor(modelId) {
  return PACKAGES[String(modelId || "")] || null;
}

/** Catalog entries for /api/models, default first then recommended (word-timestamped, smaller) before heavy ones. */
function catalogEntries() {
  const entries = Object.entries(PACKAGES).map(([id, p]) => ({ id, ...p }));
  const rank = (e) => (e.wordTimes ? 0 : 1) * 2 + (e.bytes > 3 * 1024 * 1024 * 1024 ? 1 : 0);
  return entries.sort((a, b) => {
    if (a.id === "parakeet-tdt") return -1;
    if (b.id === "parakeet-tdt") return 1;
    return rank(a) - rank(b) || a.bytes - b.bytes;
  });
}

function modelFilePath(modelId) {
  const pkg = packageFor(modelId);
  return pkg ? path.join(modelDir(modelId), pkg.file) : null;
}

/** True when the audio.cpp GGUF for this catalog id has been downloaded. */
async function modelInstalled(modelId) {
  const file = modelFilePath(modelId);
  if (!file) return false;
  try {
    const st = await fsp.stat(file);
    return st.isFile() && st.size > 1024 * 1024;
  } catch {
    return false;
  }
}

const modelDownloads = new Map();
/** Downloads the GGUF package for a catalog id into <root>/models/<id>/. onLog(text, percent). */
function downloadModel(modelId, onLog = () => {}) {
  const key = String(modelId || "");
  if (modelDownloads.has(key)) return modelDownloads.get(key);
  const pkg = packageFor(key);
  if (!pkg) return Promise.reject(new Error(`No audio.cpp package for ${modelId}`));
  const job = (async () => {
    const dest = modelFilePath(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const mb = Math.round(pkg.bytes / (1024 * 1024));
    onLog(`Downloading ${pkg.file} (~${mb} MB)…`, 0);
    await downloadFile(pkg.url, dest, (pct, received, total) => {
      const got = Math.round(received / (1024 * 1024));
      const all = total ? Math.round(total / (1024 * 1024)) : mb;
      onLog(`Downloading model… ${pct}% (${got}/${all} MB)`, pct);
    });
    onLog("Model downloaded.", 100);
  })().catch((e) => {
    modelDownloads.delete(key);
    throw e;
  }).finally(() => modelDownloads.delete(key));
  modelDownloads.set(key, job);
  return job;
}

// audio.cpp parakeet families emit `start_sample`/`end_sample` at the input sample rate
// (our pipeline always feeds 16 kHz mono WAV); seconds-based fields are used by other families.
const SAMPLE_RATE = 16000;

/** Normalizes audio.cpp words JSON into the app's word shape (seconds). Tolerant to field-name variants. */
function normalizeWords(data, sampleRate = SAMPLE_RATE) {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data?.words)
      ? data.words
      : Array.isArray(data?.tokens)
        ? data.tokens
        : [];
  return raw
    .map((w) => {
      const text = String(w?.word ?? w?.text ?? w?.token ?? "").trim();
      if (!text) return null;
      const start = w?.start_sample != null ? Number(w.start_sample) / sampleRate : Number(w?.start ?? w?.t0 ?? w?.begin ?? 0);
      const end = w?.end_sample != null ? Number(w.end_sample) / sampleRate : Number(w?.end ?? w?.t1 ?? w?.stop ?? start + 0.2);
      return { text, start, end: Math.max(end, start + 0.05) };
    })
    .filter(Boolean);
}

/** Groups words into transcript segments on speech pauses (audio.cpp families without a segment writer only emit words). */
function segmentsFromWords(words, gapSec = 0.8) {
  const segments = [];
  let current = null;
  for (const w of words) {
    if (current && w.start - current.end > gapSec) {
      segments.push(current);
      current = null;
    }
    if (!current) current = { start: w.start, end: w.end, words: [] };
    current.end = Math.max(current.end, w.end);
    current.words.push(w.text);
  }
  if (current) segments.push(current);
  return segments.map((s, i) => ({ id: i, start: s.start, end: s.end, text: s.words.join(" ") }));
}

/** Normalizes audio.cpp segments JSON into the app's segment shape. */
function normalizeSegments(data) {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data?.segments)
      ? data.segments
      : Array.isArray(data?.turns)
        ? data.turns
        : [];
  return raw
    .map((s, i) => {
      const text = String(s?.text ?? s?.transcript ?? "").trim();
      const start = Number(s?.start ?? s?.t0 ?? s?.begin ?? 0);
      const end = Number(s?.end ?? s?.t1 ?? s?.stop ?? start);
      if (!text) return null;
      return { id: Number(s?.id ?? i) || i, start, end: Math.max(end, start), text };
    })
    .filter(Boolean);
}

/** Families without a word-timestamp writer still print the transcript on stdout (`text_output=…`). */
function textFromStdout(stdout) {
  const line = String(stdout || "").split("\n").find((l) => l.startsWith("text_output="));
  if (!line) return "";
  return line.slice("text_output=".length).trim();
}

/**
 * Transcribes a 16 kHz mono WAV with the installed audio.cpp package for modelId.
 * Returns the same {text, words, segments} shape the nemo-speech path produces.
 */
async function transcribe(wav, modelId, language, workDir) {
  const found = await resolveCli();
  if (!found) throw new Error("audio.cpp runtime is not installed");
  const pkg = packageFor(modelId);
  if (!pkg) throw new Error(`No audio.cpp package for ${modelId}`);
  const modelFile = modelFilePath(modelId);
  const wordsPath = path.join(workDir, "audiocpp-words.json");
  const segPath = path.join(workDir, "audiocpp-segments.json");
  const args = [
    "--task", "asr",
    "--family", pkg.family,
    "--model", modelFile,
    "--backend", BACKEND,
    "--audio", wav,
    "--words-out", wordsPath,
    "--segments-out", segPath,
  ];
  if (language) args.push("--language", String(language));
  const r = await run(found.exe, args, { timeout: 0 });
  if (r.code !== 0) {
    const detail = String(r.stderr || r.stdout || "").split("\n").filter(Boolean).slice(-1)[0] || "audio.cpp failed";
    throw new Error(detail);
  }
  const [wordsData, segData] = await Promise.all([
    fsp.readFile(wordsPath, "utf8").then((t) => JSON.parse(t)).catch(() => null),
    fsp.readFile(segPath, "utf8").then((t) => JSON.parse(t)).catch(() => null),
  ]);
  const words = normalizeWords(wordsData);
  const fromFile = normalizeSegments(segData);
  const segments = fromFile.length ? fromFile : segmentsFromWords(words);
  const text =
    segments.map((s) => s.text).join(" ").trim() ||
    words.map((w) => w.text).join(" ").trim() ||
    textFromStdout(r.stdout);
  return { text, words, segments, backend: "audiocpp" };
}

module.exports = {
  AUDIOCPP_VERSION,
  catalogEntries,
  modelsRoot,
  resolveCli,
  ensureRuntime,
  runtimeAssetCandidates,
  extractZipNode,
  downloadFile,
  packageFor,
  modelFilePath,
  modelInstalled,
  downloadModel,
  normalizeWords,
  normalizeSegments,
  segmentsFromWords,
  transcribe,
};
