// OpenCode plugin that exposes the Puku models.
//
// Puku has no entry in the models.dev catalog, so the plugin registers the
// provider itself and binds it to a native OpenCode integration:
//
// - `opencode auth login puku` runs the Puku OAuth + PKCE flow in the browser.
//   The stored credential is an OAuth token, which the runtime sends to Puku as
//   `Authorization: Bearer <token>`; the plugin refreshes it when it expires.
// - The API-key method stores a Puku API key, which the runtime sends as
//   `x-api-key`.
//
// The models are used as `puku/<model-id>`, for example `puku/puku-ai-2.8`.

import { randomBytes } from "node:crypto"

import { PUKU } from "./constants.js"
import { listModels } from "./api.js"
import { authorizeUrl, exchangeCode, listenForCallback, openBrowser, pkce } from "./oauth.js"

export const PukuPlugin = {
  id: "puku",
  async setup(ctx) {
    const controller = new AbortController()
    // A cancelled attempt leaves its loopback listener behind unless the plugin closes it.
    const listeners = new Set()

    await ctx.integration.transform((editor) => {
      // Registering a method creates the integration, so the integration ID
      // needs no separate `editor.update` call.
      editor.method.update({
        integrationID: PUKU.integrationID,
        method: {
          id: PUKU.oauthMethodID,
          type: "oauth",
          label: "Sign in with Puku",
        },
        async authorize() {
          const { verifier, challenge } = pkce()
          const state = randomBytes(32).toString("base64url")
          const listener = await listenForCallback({ expectedState: state })
          listeners.add(listener)
          const url = authorizeUrl({ challenge, state, redirectUri: listener.redirectUri })
          openBrowser(url)
          const callback = (async () => {
            try {
              const outcome = await listener.result
              if (outcome.error) throw new Error(`Puku sign-in failed: ${outcome.error}`)
              if (!outcome.code) throw new Error("Puku did not return an authorization code")
              if (outcome.state !== state) throw new Error("Puku sign-in failed: state mismatch")
              const tokens = await exchangeCode({
                code: outcome.code,
                redirectUri: listener.redirectUri,
                verifier,
                state,
              })
              return {
                type: "oauth",
                methodID: PUKU.oauthMethodID,
                access: tokens.access,
                refresh: tokens.refresh,
                expires: tokens.expires,
              }
            } finally {
              listeners.delete(listener)
              await listener.close()
            }
          })()
          return {
            url,
            instructions: "Complete the sign-in in your browser. This window closes automatically.",
            mode: "auto",
            callback,
          }
        },
      })

      // A Puku API key works against the inference API as well. The runtime
      // sends it as `x-api-key`, the same header Puku's own CLI uses.
      editor.method.update({
        integrationID: PUKU.integrationID,
        method: { type: "key", label: "Puku API key" },
      })
    })

    // The provider references the integration, so it is published once the
    // integration exists.
    await publishModels(ctx)

    return async () => {
      controller.abort()
      for (const listener of listeners) await listener.close()
      listeners.clear()
    }
  },
}

export default PukuPlugin

/** Publishes the provider and the models Puku currently serves. */
async function publishModels(ctx) {
  const models = await listModels()
  await ctx.provider.transform((editor) => {
    const existing = editor.get(PUKU.providerID)
    if (!existing) {
      editor.add({ info: providerInfo(), models })
      return
    }
    editor.update(PUKU.providerID, (provider) => {
      provider.name = "Puku AI"
      provider.activation = "enabled"
      provider.package = PUKU.package
      provider.integrationID = PUKU.integrationID
      provider.settings = { baseURL: PUKU.apiBase }
    })
    editor.models.set(PUKU.providerID, models)
  })
}

/** The provider definition OpenCode shows in its provider list. */
function providerInfo() {
  return {
    id: PUKU.providerID,
    name: "Puku AI",
    activation: "enabled",
    package: PUKU.package,
    integrationID: PUKU.integrationID,
    settings: { baseURL: PUKU.apiBase },
  }
}
