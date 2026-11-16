import assert from "node:assert/strict"
import { test } from "node:test"

import { listModels, toModelInfo } from "../src/api.js"
import { PUKU } from "../src/constants.js"

/** Replaces the global fetch for the duration of a test. */
async function withFetch(implementation, run) {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

test("toModelInfo describes a Puku model for OpenCode", () => {
  const model = toModelInfo("puku-ai-2.8")
  assert.equal(model.id, "puku-ai-2.8")
  assert.equal(model.modelID, "puku-ai-2.8")
  assert.equal(model.providerID, PUKU.providerID)
  assert.equal(model.name, "Puku AI 2.8")
  assert.equal(model.package, PUKU.package)
  assert.deepEqual(model.capabilities, { tools: true, input: ["text", "image"], output: ["text"] })
  assert.deepEqual(model.limit, { context: PUKU.contextLimit, output: PUKU.outputLimit })
  assert.equal(model.status, "active")
  assert.equal(model.enabled, true)
})

test("toModelInfo uses the model id as the name of an unknown model", () => {
  assert.equal(toModelInfo("puku-ai-9.9").name, "puku-ai-9.9")
})

test("listModels reads the catalog", async () => {
  await withFetch(
    async () =>
      new Response(JSON.stringify({ data: [{ id: "puku-ai-2.8" }, { id: "puku-ai-2.7" }] }), {
        headers: { "content-type": "application/json" },
      }),
    async () => {
      const models = await listModels()
      assert.deepEqual(
        models.map((model) => model.id),
        ["puku-ai-2.8", "puku-ai-2.7"],
      )
    },
  )
})

test("listModels falls back to the known models when the catalog fails", async () => {
  await withFetch(
    async () => {
      throw new Error("offline")
    },
    async () => {
      const models = await listModels()
      assert.deepEqual(
        models.map((model) => model.id),
        PUKU.fallbackModels,
      )
    },
  )
})

test("listModels falls back to the known models when the catalog is empty", async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ data: [] }), { headers: { "content-type": "application/json" } }),
    async () => {
      const models = await listModels()
      assert.deepEqual(
        models.map((model) => model.id),
        PUKU.fallbackModels,
      )
    },
  )
})
