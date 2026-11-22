"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWords,
  normalizeSegments,
  segmentsFromWords,
  packageFor,
  modelFilePath,
} = require("./audiocpp.cjs");

test("normalizeWords converts audio.cpp sample-based timestamps to seconds", () => {
  const words = normalizeWords([
    { start_sample: 0, end_sample: 16000, word: "Hello", confidence: 0 },
    { start_sample: 16000, end_sample: 32000, word: "world,", confidence: 0 },
  ]);
  assert.equal(words.length, 2);
  assert.deepEqual(words[0], { text: "Hello", start: 0, end: 1 });
  assert.deepEqual(words[1], { text: "world,", start: 1, end: 2 });
});

test("normalizeWords accepts seconds-based words and nested shapes", () => {
  const words = normalizeWords({ words: [{ text: "hi", start: 0.5, end: 0.8 }] });
  assert.equal(words.length, 1);
  assert.equal(words[0].text, "hi");
  assert.equal(words[0].start, 0.5);
  assert.equal(normalizeWords(null).length, 0);
  assert.equal(normalizeWords([{ text: "  " }]).length, 0);
});

test("normalizeSegments keeps text segments and tolerates missing files", () => {
  const segs = normalizeSegments([
    { id: 0, start: 0, end: 1.2, text: "hello there" },
    { start: 2, end: 3, text: "second line" },
  ]);
  assert.equal(segs.length, 2);
  assert.equal(segs[1].id, 1);
  assert.equal(segs[0].text, "hello there");
  assert.equal(normalizeSegments(null).length, 0);
  assert.equal(normalizeSegments([{ start: 0, end: 1 }]).length, 0);
});

test("segmentsFromWords splits transcript into segments on speech gaps", () => {
  const words = [
    { text: "one", start: 0, end: 0.5 },
    { text: "two", start: 0.5, end: 1.0 },
    { text: "after", start: 2.5, end: 3.0 },
  ];
  const segs = segmentsFromWords(words);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, "one two");
  assert.equal(segs[0].end, 1.0);
  assert.equal(segs[1].text, "after");
  assert.equal(segs[1].start, 2.5);
  assert.equal(segmentsFromWords([]).length, 0);
});

test("packageFor maps catalog ids to audio.cpp packages and modelFilePath joins safely", () => {
  assert.equal(packageFor("parakeet-tdt").family, "parakeet_tdt");
  assert.equal(packageFor("parakeet-ctc"), null);
  assert.equal(packageFor(undefined), null);
  const file = modelFilePath("parakeet-tdt");
  assert.ok(file.endsWith("parakeet-tdt-0.6b-v3-q8_0.gguf"));
  assert.ok(file.includes("parakeet-tdt"));
  assert.equal(modelFilePath("parakeet-ctc"), null);
});

test("catalog covers the audio.cpp ASR GGUFs with complete download info", () => {
  const { catalogEntries } = require("./audiocpp.cjs");
  const entries = catalogEntries();
  assert.ok(entries.length >= 25, `expected the full catalog, got ${entries.length}`);
  const ids = new Set(entries.map((e) => e.id));
  assert.equal(ids.size, entries.length, "catalog ids must be unique");
  for (const e of entries) {
    assert.ok(e.family, `missing family: ${e.id}`);
    assert.ok(e.file.endsWith(".gguf"), `missing file: ${e.id}`);
    assert.ok(/^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+\.gguf$/.test(e.url), `bad url: ${e.url}`);
    assert.ok(e.bytes > 1024 * 1024, `bad size: ${e.id}`);
    assert.ok(e.label && e.note, `missing label/note: ${e.id}`);
  }
  assert.equal(entries[0].id, "parakeet-tdt", "default model sorts first");
});
