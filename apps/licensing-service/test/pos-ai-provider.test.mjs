import test from "node:test";
import assert from "node:assert/strict";
import { createPosAiProvider } from "../dist/pos-ai-provider.js";

function fakeFetch(payload, observe = () => {}) {
  return async (url, init) => {
    observe(url, init);
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: payload }] } }],
      }),
    };
  };
}

test("Gemini provider sends secret server-side and accepts only exact catalog questionId", async () => {
  let seen;
  const provider = createPosAiProvider({
    apiKey: "server-key",
    model: "gemini-3.1-flash-lite",
    fetchImpl: fakeFetch("sales-today", (...args) => {
      seen = args;
    }),
  });
  assert.deepEqual(await provider.resolve("ventas de hoy"), {
    questionId: "sales-today",
  });
  assert.doesNotMatch(seen[0], /key=/);
  assert.equal(seen[1].headers["x-goog-api-key"], "server-key");
  assert.equal(seen[1].method, "POST");
  const request = JSON.parse(seen[1].body);
  assert.deepEqual(request.contents, [
    { role: "user", parts: [{ text: "ventas de hoy" }] },
  ]);
  assert.equal(request.generationConfig.responseSchema.enum.length, 11);
  assert.equal(seen[1].redirect, "error");
});

test("unsupported question is a localizable no-match, not a generated answer", async () => {
  const provider = createPosAiProvider({
    apiKey: "server-key",
    fetchImpl: fakeFetch("none"),
  });
  assert.deepEqual(await provider.resolve("¿Qué tiempo hace?"), {
    questionId: null,
  });
});

test("provider rejects made-up catalog IDs and numeric outputs", async () => {
  const provider = createPosAiProvider({
    apiKey: "server-key",
    fetchImpl: fakeFetch("invented"),
  });
  await assert.rejects(provider.resolve("pizza"), /invalid_provider_response/);
  const numeric = createPosAiProvider({
    apiKey: "server-key",
    fetchImpl: fakeFetch("123"),
  });
  await assert.rejects(numeric.resolve("pizza"), /invalid_provider_response/);
});

test("provider validates bounds and config, and collapses upstream errors", async () => {
  assert.throws(() => createPosAiProvider({ apiKey: "" }), /GEMINI_API_KEY/);
  assert.throws(
    () => createPosAiProvider({ apiKey: "k", model: "../bad" }),
    /POS_AI_MODEL/,
  );
  const provider = createPosAiProvider({
    apiKey: "k",
    fetchImpl: async () => {
      throw new Error("secret upstream detail");
    },
  });
  await assert.rejects(provider.resolve("x".repeat(501)), /invalid_prompt/);
  await assert.rejects(provider.resolve("hello"), /provider_unavailable/);
});
