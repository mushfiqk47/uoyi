"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveGeminiModel, generateWithFallback, GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL } = require("./gemini.cjs");

test("resolveGeminiModel keeps a custom model name", () => {
  assert.equal(resolveGeminiModel("gemini-4-hydrogen"), "gemini-4-hydrogen");
  assert.equal(resolveGeminiModel("my-custom-model"), "my-custom-model");
  assert.equal(resolveGeminiModel("  gemini-3.1-flash-lite  "), "gemini-3.1-flash-lite");
});

test("resolveGeminiModel still replaces empty and retired names", () => {
  assert.equal(resolveGeminiModel(""), "gemini-4-hydrogen");
  assert.equal(resolveGeminiModel("gemini-2.5-flash"), "gemini-4-hydrogen");
});

test("resolveGeminiModel maps legacy -latest aliases to current models", () => {
  assert.equal(resolveGeminiModel("gemini-flash-lite-latest"), GEMINI_FALLBACK_MODEL);
  assert.equal(resolveGeminiModel("gemini-flash-latest"), GEMINI_DEFAULT_MODEL);
  assert.equal(resolveGeminiModel("gemini-pro-latest"), GEMINI_DEFAULT_MODEL);
});

test("generateWithFallback retries a built-in model when the requested model is unknown", async () => {
  const seen = [];
  const ai = {
    models: {
      generateContent: async (request) => {
        seen.push(request.model);
        if (request.model === "gemini-flash-lite-latest") {
          throw new Error("models/gemini-flash-lite-latest is not found for API version v1, or is not supported for generateContent.");
        }
        return { text: "ok" };
      },
    },
  };
  const { response, usedModel } = await generateWithFallback(ai, { model: "gemini-flash-lite-latest", contents: [] });
  assert.equal(usedModel, GEMINI_DEFAULT_MODEL);
  assert.equal(response.text, "ok");
  assert.deepEqual(seen, ["gemini-flash-lite-latest", GEMINI_DEFAULT_MODEL]);
});

test("generateWithFallback surfaces non-model errors as-is", async () => {
  const ai = {
    models: {
      generateContent: async () => {
        throw new Error("API key not valid");
      },
    },
  };
  await assert.rejects(
    () => generateWithFallback(ai, { model: GEMINI_DEFAULT_MODEL, contents: [] }),
    /API key not valid/,
  );
});
