import assert from "node:assert/strict"
import { test } from "node:test"

import { PUKU } from "../src/constants.js"
import { createApiKey } from "../src/keys.js"

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

test("createApiKey trades the access token for Puku's raw key", async () => {
  let request
  await withFetch(
    async (url, init) => {
      request = { url: String(url), init }
      return new Response(JSON.stringify({ raw_key: "pk-the-key" }), {
        headers: { "content-type": "application/json" },
      })
    },
    async () => {
      const key = await createApiKey("the-access-token")
      assert.equal(key, "pk-the-key")
    },
  )

  assert.equal(request.url, PUKU.apiKeyUrl)
  assert.equal(request.init.method, "POST")
  assert.equal(request.init.headers.authorization, "Bearer the-access-token")
})

test("createApiKey reports a refused request", async () => {
  await withFetch(
    async () => new Response("nope", { status: 403 }),
    async () => {
      await assert.rejects(() => createApiKey("the-access-token"), /could not create an API key \(403\)/)
    },
  )
})

test("createApiKey reports a response without a key", async () => {
  await withFetch(
    async () => new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }),
    async () => {
      await assert.rejects(() => createApiKey("the-access-token"), /did not return an API key/)
    },
  )
})

test("createApiKey needs an access token", async () => {
  await assert.rejects(() => createApiKey(""), /needs an access token/)
})
