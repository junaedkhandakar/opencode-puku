import assert from "node:assert/strict"
import { test } from "node:test"

import { PUKU } from "../src/constants.js"
import PukuPlugin from "../src/index.js"

/**
 * A stand-in for the OpenCode plugin context that follows the promise plugin
 * API: `integration.transform`, `provider.transform` and `command.transform`
 * each hand an editor to the plugin.
 */
function context() {
  const storage = new Map()
  const messages = []
  const integrations = new Map()
  const methods = []
  const providers = new Map()
  const commands = []
  const events = []
  // A queue that yields events pushed after the subscription started.
  const END = Symbol("end of events")
  const waiters = []
  const eventQueue = (async function* () {
    for (const event of events) yield event
    while (true) {
      const next = await new Promise((resolve) => waiters.push(resolve))
      if (next === END) return
      yield next
    }
  })()
  /** Wakes the subscription with an event. */
  const emit = (event) => {
    const waiter = waiters.shift()
    if (waiter) waiter(event)
    else events.push(event)
  }
  /** Ends the subscription so the plugin's cleanup can finish. */
  const endEvents = () => {
    const waiter = waiters.shift()
    if (waiter) waiter(END)
  }
  const reloads = { provider: 0, integration: 0, command: 0 }
  const attempts = new Map()
  let attemptSeq = 0

  const integrationEditor = {
    list: () => [...integrations.values()].map((integration) => ({ id: integration.id, name: integration.name })),
    get: (id) => integrations.get(id),
    update: (id, update) => {
      const integration = integrations.get(id)
      if (!integration) throw new Error(`unknown integration ${id}`)
      update(integration)
    },
    remove: (id) => integrations.delete(id),
    method: {
      list: (integrationID) => methods.filter((entry) => entry.integrationID === integrationID),
      update: (input) => {
        // Registering a method creates the integration, like OpenCode does.
        if (!integrations.has(input.integrationID)) {
          integrations.set(input.integrationID, { id: input.integrationID, name: input.integrationID })
        }
        const index = methods.findIndex(
          (entry) => entry.integrationID === input.integrationID && entry.method.id === input.method.id,
        )
        const entry = { integrationID: input.integrationID, ...input }
        if (index >= 0) methods[index] = entry
        else methods.push(entry)
      },
      remove: (integrationID, method) => {
        const index = methods.findIndex(
          (entry) => entry.integrationID === integrationID && entry.method.id === method.id,
        )
        if (index >= 0) methods.splice(index, 1)
      },
    },
  }

  const providerEditor = {
    list: () =>
      [...providers.values()].map((record) => ({
        provider: record.info,
        models: new Map(record.models.map((model) => [model.id, model])),
      })),
    get: (providerID) => {
      const record = providers.get(providerID)
      if (!record) return undefined
      return {
        provider: record.info,
        models: new Map(record.models.map((model) => [model.id, model])),
      }
    },
    update: (providerID, update) => {
      const record = providers.get(providerID)
      if (!record) throw new Error(`unknown provider ${providerID}`)
      update(record.info)
    },
    remove: (providerID) => providers.delete(providerID),
    add: (input) => {
      providers.set(input.info.id, {
        info: input.info,
        models: [...input.models],
        sourceConnection: input.sourceConnection,
      })
    },
    models: {
      set: (providerID, models) => {
        const record = providers.get(providerID)
        if (!record) throw new Error(`unknown provider ${providerID}`)
        record.models = [...models]
      },
      update: (providerID, modelID, update) => {
        const record = providers.get(providerID)
        const index = record?.models.findIndex((model) => model.id === modelID) ?? -1
        if (record && index >= 0) update(record.models[index])
      },
      remove: (providerID, modelID) => {
        const record = providers.get(providerID)
        if (!record) return
        record.models = record.models.filter((model) => model.id !== modelID)
      },
    },
  }

  const host = {
    storage,
    messages,
    methods,
    providers,
    commands,
    events,
    reloads: () => ({ ...reloads }),
    providerRecord: (providerID) => providers.get(providerID),
    emit,
    endEvents,
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
      integration: {
        transform: async (callback) => {
          callback(integrationEditor)
        },
        reload: async () => {
          reloads.integration += 1
        },
        connection: {
          active: async () => undefined,
          resolve: async () => undefined,
          status: async () => {},
        },
        oauth: {
          connect: async (input) => {
            attemptSeq += 1
            const attemptID = `con_${attemptSeq}`
            const attempt = {
              attemptID,
              url: "https://puku.sh/api/oauth/authorize",
              instructions: "Sign in",
              mode: "auto",
              time: { created: Date.now(), expires: Date.now() + 600_000 },
            }
            // The attempt settles on the first poll, as a finished sign-in does.
            attempts.set(attemptID, { status: "complete", time: attempt.time })
            return { location: { id: "loc_1" }, data: attempt }
          },
          status: async (input) => {
            const attempt = attempts.get(input.attemptID)
            if (!attempt) throw new Error(`unknown attempt ${input.attemptID}`)
            return { location: { id: "loc_1" }, data: attempt }
          },
          complete: async () => {},
          cancel: async (input) => {
            attempts.set(input.attemptID, {
              status: "failed",
              message: "cancelled",
              time: { created: Date.now(), expires: Date.now() },
            })
          },
        },
      },
      provider: {
        transform: async (callback) => {
          callback(providerEditor)
        },
        reload: async () => {
          reloads.provider += 1
        },
      },
      command: {
        transform: async (callback) => {
          callback({ add: (definition) => commands.push(definition) })
        },
        reload: async () => {
          reloads.command += 1
        },
      },
      session: {
        synthetic: async ({ sessionID, text }) => {
          messages.push({ sessionID, text })
        },
      },
      event: {
        // The stream stays open so a late event is delivered, and it ends when
        // the plugin aborts it, like the server's.
        subscribe: async function* ({ signal } = {}) {
          for (;;) {
            const abort = new Promise((resolve) => {
              if (signal?.aborted) resolve({ done: true, value: undefined })
              else signal?.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true })
            })
            const step = await Promise.race([eventQueue.next(), abort])
            if (step.done) return
            yield step.value
          }
        },
      },
    },
  }

  return host
}

/** A fetch that answers the Puku endpoints and passes loopback calls through. */
function pukuFetch(realFetch) {
  return async (url, init) => {
    const target = String(url)
    if (target.startsWith("http://127.0.0.1:")) return realFetch(url, init)
    if (target === `${PUKU.apiBase}/models`) {
      return new Response(JSON.stringify({ data: [{ id: "puku-ai-2.8" }] }), {
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

test("the plugin has an id and a setup", () => {
  assert.equal(PukuPlugin.id, "puku")
  assert.equal(typeof PukuPlugin.setup, "function")
})

test("the plugin registers the Puku integration with an OAuth and a key method", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    const oauth = host.methods.find(
      (entry) => entry.integrationID === PUKU.integrationID && entry.method.type === "oauth",
    )
    assert.ok(oauth, "an OAuth method is registered")
    assert.equal(oauth.method.id, PUKU.oauthMethodID)
    assert.equal(oauth.method.label, "Sign in with Puku")
    assert.equal(typeof oauth.authorize, "function")
    assert.equal(typeof oauth.refresh, "function")

    const key = host.methods.find(
      (entry) => entry.integrationID === PUKU.integrationID && entry.method.type === "key",
    )
    assert.ok(key, "a key method is registered")
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the plugin registers the Puku provider with the discovered models", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    const record = host.providerRecord(PUKU.providerID)
    assert.ok(record, "the Puku provider is published")
    assert.equal(record.info.id, PUKU.providerID)
    assert.equal(record.info.name, "Puku AI")
    assert.equal(record.info.activation, "enabled")
    assert.equal(record.info.package, PUKU.package)
    assert.equal(record.info.settings.baseURL, PUKU.apiBase)
    assert.equal(record.info.integrationID, PUKU.integrationID)
    // Puku's own CLI sends this beta flag with every OAuth request.
    assert.equal(record.info.headers["anthropic-beta"], PUKU.anthropicBeta)

    assert.deepEqual(
      record.models.map((model) => model.id),
      ["puku-ai-2.8"],
    )
    assert.equal(record.models[0].providerID, PUKU.providerID)
    assert.deepEqual(record.models[0].limit, { context: PUKU.contextLimit, output: PUKU.outputLimit })
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the plugin registers the login and status commands", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)
    assert.deepEqual(
      host.commands.map((command) => command.name),
      ["puku-login", "puku-status"],
    )
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the login command starts a native OAuth attempt and reports the result", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    const login = host.commands.find((command) => command.name === "puku-login")
    const finished = login.execute({
      sessionID: "ses_test",
      prompt: { text: "/puku-login" },
      delivery: "steer",
    })

    // The attempt stays pending, so the status poll keeps waiting.
    await waitFor(() => host.messages.length > 0 || host.reloads().provider > 0)

    assert.ok(host.ctx.integration.oauth)
    await finished

    assert.ok(
      host.messages.some((entry) => entry.text.includes("Puku AI is connected")),
      `expected a connected message, got ${JSON.stringify(host.messages)}`,
    )
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the status command reports a disconnected account", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    const status = host.commands.find((command) => command.name === "puku-status")
    await status.execute({ sessionID: "ses_test", prompt: { text: "/puku-status" }, delivery: "steer" })

    assert.equal(host.messages.length, 1)
    assert.match(host.messages[0].text, /not connected/i)
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the cleanup closes the loopback listeners", async () => {
  const realFetch = globalThis.fetch
  const originalBrowser = process.env.PUKU_OPEN_BROWSER
  process.env.PUKU_OPEN_BROWSER = "0"
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    const cleanup = await PukuPlugin.setup(host.ctx)
    assert.equal(typeof cleanup, "function")

    const oauth = host.methods.find((entry) => entry.method.type === "oauth")
    const authorization = await oauth.authorize({})
    // The listener holds a port until it is closed.
    const redirect = new URL(authorization.url).searchParams.get("redirect_uri")
    assert.ok(redirect, "the authorization URL carries a redirect URI")

    await cleanup()
  } finally {
    globalThis.fetch = realFetch
    if (originalBrowser === undefined) delete process.env.PUKU_OPEN_BROWSER
    else process.env.PUKU_OPEN_BROWSER = originalBrowser
  }
})

test("a credential update reloads the provider and republishes the models", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    const before = host.reloads().provider
    host.emit({
      type: "credential.updated",
      properties: { integrationID: PUKU.integrationID, credentialID: "cred_1" },
    })

    await waitFor(() => host.reloads().provider > before)
    const record = host.providerRecord(PUKU.providerID)
    assert.deepEqual(
      record.models.map((model) => model.id),
      ["puku-ai-2.8"],
    )
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the OAuth method refreshes an expired credential", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    const oauth = host.methods.find((entry) => entry.method.type === "oauth")
    const refreshed = await oauth.refresh({
      type: "oauth",
      methodID: PUKU.oauthMethodID,
      access: "old-access",
      refresh: "the-refresh",
      expires: Date.now() - 1_000,
    })

    assert.equal(refreshed.type, "oauth")
    assert.equal(refreshed.methodID, PUKU.oauthMethodID)
    assert.equal(refreshed.access, "the-access")
    assert.equal(refreshed.refresh, "the-refresh")
    assert.ok(refreshed.expires > Date.now())
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the OAuth method exchanges the callback code for a credential", async () => {
  const realFetch = globalThis.fetch
  const originalBrowser = process.env.PUKU_OPEN_BROWSER
  process.env.PUKU_OPEN_BROWSER = "0"
  globalThis.fetch = pukuFetch(realFetch)
  try {
    const host = context()
    await PukuPlugin.setup(host.ctx)

    const oauth = host.methods.find((entry) => entry.method.type === "oauth")
    const authorization = await oauth.authorize({})
    assert.equal(authorization.mode, "auto")
    assert.ok(authorization.url.startsWith(PUKU.authorizeUrl))
    assert.ok(authorization.instructions)

    // The browser redirects back to the loopback listener with a code.
    const redirect = new URL(authorization.url).searchParams.get("redirect_uri")
    const state = new URL(authorization.url).searchParams.get("state")
    const response = await fetch(`${redirect}?code=the-code&state=${state}`)
    assert.equal(response.status, 200)

    const credential = await authorization.callback
    assert.equal(credential.type, "oauth")
    assert.equal(credential.methodID, PUKU.oauthMethodID)
    assert.equal(credential.access, "the-access")
    assert.equal(credential.refresh, "the-refresh")
    assert.ok(credential.expires > Date.now())
  } finally {
    globalThis.fetch = realFetch
    if (originalBrowser === undefined) delete process.env.PUKU_OPEN_BROWSER
    else process.env.PUKU_OPEN_BROWSER = originalBrowser
  }
})
