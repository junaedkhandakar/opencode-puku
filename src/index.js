// Puku AI provider for OpenCode.
//
// Registers `puku` as an integration and as a provider (Anthropic-compatible
// Messages API), then adds the Puku models to the model list.
//
// Two sign-in paths are offered by OpenCode itself:
//
// - `opencode auth login puku` runs the Puku OAuth + PKCE flow in the browser.
//   The stored credential is an OAuth token, which the runtime sends to Puku as
//   `Authorization: Bearer <token>`; the plugin refreshes it when it expires.
// - `opencode auth login puku` with the API-key method stores a Puku API key,
//   which the runtime sends as `x-api-key`.
//
// The models are used as `puku/<model-id>`, for example `puku/puku-ai-2.8`.

import { randomBytes } from "node:crypto"

import { PUKU } from "./constants.js"
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

    return async () => {
      controller.abort()
      for (const listener of listeners) await listener.close()
      listeners.clear()
    }
  },
}

export default PukuPlugin
