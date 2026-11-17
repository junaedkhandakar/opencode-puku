// OpenCode plugin that exposes the Puku models.
//
// Puku has no entry in the models.dev catalog and an OpenCode plugin cannot
// create an integration, so the plugin registers the provider itself:
//
// - the provider points at Puku's Anthropic-compatible API and carries the API
//   key, which the runtime sends as `x-api-key`;
// - `/puku-signin` runs the Puku OAuth + PKCE flow in the browser, mints an
//   API key from the access token and stores it.
//
// The models are used as `puku/<model-id>`, for example `puku/puku-ai-2.8`.

import { randomBytes } from "node:crypto"

import { listModels } from "./api.js"
import { PUKU } from "./constants.js"
import { createApiKey } from "./keys.js"
import { authorizeUrl, exchangeCode, listenForCallback, openBrowser, pkce } from "./oauth.js"

/** Storage key of the Puku API key. */
const KEY = "puku-api-key"

export const PukuPlugin = {
  id: "puku",
  async setup(ctx) {
    // Both are read by the provider transform, which OpenCode re-runs whenever
    // the providers are reloaded. Update them before reloading.
    let apiKey = await readKey(ctx)
    let models = await listModels()

    await ctx.provider.transform((editor) => {
      editor.add({
        info: providerInfo(apiKey),
        models,
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "puku-signin",
        description: "Sign in to Puku AI and add the Puku models to OpenCode",
        execute: async ({ sessionID }) => {
          await report(ctx, sessionID, "Opening the Puku sign-in page in your browser...")
          try {
            apiKey = await signIn((url) => report(ctx, sessionID, `Sign in here: ${url}`))
            await ctx.storage.set(KEY, apiKey)
            models = await listModels()
            await ctx.provider.reload()
          } catch (error) {
            await report(ctx, sessionID, `Puku sign-in failed: ${describe(error)}`)
            return
          }
          await report(
            ctx,
            sessionID,
            "Puku AI is connected. Pick a Puku model with /models, for example puku/puku-ai-2.8.",
          )
        },
      })

      editor.add({
        name: "puku-signout",
        description: "Remove the Puku API key from OpenCode",
        execute: async ({ sessionID }) => {
          await ctx.storage.remove(KEY)
          apiKey = undefined
          await ctx.provider.reload()
          await report(ctx, sessionID, "The Puku API key was removed.")
        },
      })
    })
  },
}

export default PukuPlugin

/** The provider definition OpenCode shows in its provider list. */
function providerInfo(apiKey) {
  return {
    id: PUKU.providerID,
    name: "Puku AI",
    activation: "enabled",
    package: PUKU.package,
    // The runtime appends `/messages` to the base URL and sends the key as
    // `x-api-key`, which is what Puku's inference API expects.
    settings: {
      baseURL: PUKU.apiBase,
      ...(apiKey ? { apiKey } : {}),
    },
  }
}

/** The stored key, or the environment override that replaces it at startup. */
async function readKey(ctx) {
  const fromEnv = process.env.PUKU_AI_API_KEY ?? process.env.PUKU_API_KEY
  if (fromEnv?.trim()) return fromEnv.trim()
  const stored = await ctx.storage.get(KEY)
  return typeof stored === "string" && stored ? stored : undefined
}

/** Runs the Puku OAuth flow and returns the minted API key. */
async function signIn(onUrl) {
  const { verifier, challenge } = pkce()
  const state = randomBytes(32).toString("base64url")
  const listener = await listenForCallback()
  const redirectUri = listener.redirectUri
  const url = authorizeUrl({ challenge, state, redirectUri })
  openBrowser(url)
  await onUrl?.(url)
  try {
    const result = await listener.result
    if (result.error) throw new Error(result.error)
    if (result.state !== state) throw new Error("Puku returned an unexpected OAuth state")
    if (!result.code) throw new Error("Puku did not return an authorization code")
    const tokens = await exchangeCode({ code: result.code, redirectUri, verifier, state })
    return await createApiKey(tokens.access)
  } finally {
    await listener.close()
  }
}

/** Tells the user what happened without spending a model turn. */
async function report(ctx, sessionID, text) {
  try {
    await ctx.session.synthetic({ sessionID, text })
  } catch (error) {
    // The status is a courtesy, but a swallowed failure hides why a sign-in
    // did not finish, so it also goes to the server log.
    console.error(`[opencode-puku] ${text} (report failed: ${describe(error)})`)
  }
}

const describe = (error) => (error instanceof Error ? error.message : String(error))
