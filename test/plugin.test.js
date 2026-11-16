import assert from "node:assert/strict"
import { test } from "node:test"

import { PUKU } from "../src/constants.js"
import PukuPlugin from "../src/index.js"

/** A minimal stand-in for the OpenCode plugin context. */
function context() {
  const methods = []
  const providers = []
  let reloads = 0
  return {
    methods,
    providers,
    reloads: () => reloads,
    ctx: {
      integration: {
        transform: async (callback) => {
          callback({ method: { update: (method) => methods.push(method) } })
        },
      },
      provider: {
        transform: async (callback) => {
          callback({ add: (definition) => providers.push(definition) })
        },
        reload: async () => {
          reloads += 1
        },
      },
    },
  }
}

/** Runs the plugin setup against a context and a catalog that never changes. */
async function setup() {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "puku-ai-2.8" }] }), {
      headers: { "content-type": "application/json" },
    })
  const host = context()
  try {
    await PukuPlugin.setup(host.ctx)
  } finally {
    globalThis.fetch = original
  }
  return host
}

test("the plugin has an id and a setup", () => {
  assert.equal(PukuPlugin.id, "opencode-puku")
  assert.equal(typeof PukuPlugin.setup, "function")
})

test("the plugin registers the Puku OAuth method", async () => {
  const host = await setup()
  assert.equal(host.methods.length, 1)

  const method = host.methods[0]
  assert.equal(method.integrationID, PUKU.integrationID)
  assert.equal(method.method.id, PUKU.oauthMethodID)
  assert.equal(method.method.type, "oauth")
  assert.equal(typeof method.authorize, "function")
  assert.equal(typeof method.refresh, "function")
})

test("the plugin publishes the Puku provider", async () => {
  const host = await setup()
  assert.equal(host.providers.length, 1)

  const definition = host.providers[0]
  assert.equal(definition.info.id, PUKU.providerID)
  assert.equal(definition.info.package, PUKU.package)
  assert.equal(definition.info.integrationID, PUKU.integrationID)
  assert.equal(definition.info.activation, "auto")
  assert.equal(definition.info.settings.baseURL, PUKU.apiBase)
  assert.deepEqual(
    definition.models.map((model) => model.id),
    PUKU.fallbackModels,
  )
})

test("the plugin reloads the providers once the catalog answers", async () => {
  const host = await setup()
  assert.equal(host.reloads(), 1)
})
