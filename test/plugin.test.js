import assert from "node:assert/strict"
import { test } from "node:test"

import { PUKU } from "../src/constants.js"
import PukuPlugin from "../src/index.js"

/** A minimal stand-in for the OpenCode plugin context. */
function context() {
  const storage = new Map()
  const providers = []
  const commands = []
  const messages = []
  const transforms = []
  let reloads = 0

  const editor = {
    add: (definition) => providers.push(definition),
  }

  return {
    storage,
    providers,
    commands,
    messages,
    reloads: () => reloads,
    ctx: {
      storage: {
        get: async (key) => storage.get(key),
        set: async (key, value) => {
          storage.set(key, value)
        },
        remove: async (key) => {
          storage.delete(key)
        },
      },
      provider: {
        transform: async (callback) => {
          transforms.push(callback)
          callback(editor)
        },
        reload: async () => {
          reloads += 1
          // OpenCode re-runs the transforms when the providers reload.
          for (const transform of transforms) transform(editor)
        },
      },
      command: {
        transform: async (callback) => {
          callback({ add: (definition) => commands.push(definition) })
        },
      },
      session: {
        synthetic: async ({ sessionID, text }) => {
          messages.push({ sessionID, text })
        },
      },
    },
  }
}

/** Waits until the context reports something that matches. */
async function waitFor(match) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const value = match()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("timed out waiting for the plugin")
}

/** A fetch that answers the Puku endpoints and passes loopback calls through. */
function pukuFetch(realFetch, { key = "pk-the-key" } = {}) {
  return async (url, init) => {
    const target = String(url)
    if (target.startsWith("http://127.0.0.1:")) return realFetch(url, init)
    if (target === `${PUKU.apiBase}/models`) {
      return new Response(JSON.stringify({ data: [{ id: "puku-ai-2.8" }] }), {
        headers: { "content-type": "application/json" },
      })
    }
    if (target === PUKU.apiKeyUrl) {
      return new Response(JSON.stringify({ raw_key: key }), {
        headers: { "content-type": "application/json" },
      })
    }
    // The form encoding is refused, so the JSON body is used.
    if (init?.headers?.["content-type"] === "application/x-www-form-urlencoded") {
      return new Response("{}", { status: 400 })
    }
    return new Response(
      JSON.stringify({ access_token: "the-access", refresh_token: "the-refresh", expires_in: 3600 }),
      { headers: { "content-type": "application/json" } },
    )
  }
}

test("the plugin has an id and a setup", () => {
  assert.equal(PukuPlugin.id, "puku")
  assert.equal(typeof PukuPlugin.setup, "function")
})

test("the plugin registers the Puku provider", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    assert.equal(host.providers.length, 1)
    const definition = host.providers[0]
    assert.equal(definition.info.id, PUKU.providerID)
    assert.equal(definition.info.name, "Puku AI")
    assert.equal(definition.info.activation, "enabled")
    assert.equal(definition.info.package, PUKU.package)
    assert.equal(definition.info.settings.baseURL, "https://api-cli.puku.sh/v1")
    assert.equal(definition.info.integrationID, undefined)
    assert.deepEqual(
      definition.models.map((model) => model.id),
      ["puku-ai-2.8"],
    )
    assert.equal(definition.models[0].providerID, PUKU.providerID)
    assert.deepEqual(definition.models[0].limit, { context: PUKU.contextLimit, output: PUKU.outputLimit })
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the plugin registers the sign-in commands", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)
    assert.deepEqual(
      host.commands.map((command) => command.name),
      ["puku-signin", "puku-signout"],
    )
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the sign-in command mints a key, stores it and reloads the provider", async () => {
  const realFetch = globalThis.fetch
  const originalBrowser = process.env.PUKU_OPEN_BROWSER
  process.env.PUKU_OPEN_BROWSER = "0"
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    const signin = host.commands.find((command) => command.name === "puku-signin")
    const finished = signin.execute({
      sessionID: "ses_test",
      prompt: { text: "/puku-signin" },
      delivery: "steer",
    })

    const url = await waitFor(() => {
      const message = host.messages.find((entry) => entry.text.startsWith("Sign in here:"))
      return message?.text.slice("Sign in here: ".length)
    })
    const parsed = new URL(url)
    assert.equal(parsed.origin + parsed.pathname, PUKU.authorizeUrl)
    assert.equal(parsed.searchParams.get("client_id"), "puku-cli")

    const redirectUri = parsed.searchParams.get("redirect_uri")
    const state = parsed.searchParams.get("state")
    const response = await realFetch(`${redirectUri}?code=the-code&state=${state}`)
    assert.equal(response.status, 200)

    await finished
    assert.equal(host.storage.get("puku-api-key"), "pk-the-key")
    assert.equal(host.reloads(), 1)
    assert.equal(host.providers.at(-1).info.settings.apiKey, "pk-the-key")
    assert.ok(host.messages.some((entry) => entry.text.includes("Puku AI is connected")))
  } finally {
    globalThis.fetch = realFetch
    if (originalBrowser === undefined) delete process.env.PUKU_OPEN_BROWSER
    else process.env.PUKU_OPEN_BROWSER = originalBrowser
  }
})

test("the sign-out command removes the stored key", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    host.storage.set("puku-api-key", "pk-the-key")
    await PukuPlugin.setup(host.ctx)

    const signout = host.commands.find((command) => command.name === "puku-signout")
    await signout.execute({ sessionID: "ses_test", prompt: { text: "/puku-signout" }, delivery: "steer" })

    assert.equal(host.storage.has("puku-api-key"), false)
    assert.equal(host.providers.at(-1).info.settings.apiKey, undefined)
  } finally {
    globalThis.fetch = realFetch
  }
})
