// OpenCode plugin that exposes the Puku models and the Puku sign-in.
//
// The plugin contributes two things to OpenCode:
//
// - an integration named `puku` with a browser OAuth method, so OpenCode
//   stores the Puku credential and renews it when the access token expires;
// - a provider named `puku` that points at Puku's Anthropic-compatible
//   inference API.
//
// The provider carries the integration ID, so OpenCode resolves the stored
// credential on its own and hands the access token to the provider package.

import { randomBytes } from "node:crypto"

import { listModels, toModelInfo } from "./api.js"
import { PUKU } from "./constants.js"
import { authorizeUrl, exchangeCode, listenForCallback, openBrowser, pkce, refreshAccessToken } from "./oauth.js"

/** The provider definition OpenCode shows in its provider list. */
function providerInfo() {
  return {
    id: PUKU.providerID,
    name: "Puku",
    // The provider stays hidden until the Puku integration has a connection.
    activation: "auto",
    package: PUKU.package,
    integrationID: PUKU.integrationID,
    settings: { baseURL: PUKU.apiBase },
  }
}

/** Turns an OAuth token pair into the credential OpenCode stores. */
function credential(tokens) {
  return {
    type: "oauth",
    methodID: PUKU.oauthMethodID,
    access: tokens.access,
    refresh: tokens.refresh,
    expires: tokens.expires,
  }
}

/**
 * Starts the browser sign-in. The returned promise resolves with the stored
 * credential once Puku calls the loopback listener back.
 */
async function authorize() {
  const { verifier, challenge } = pkce()
  const state = randomBytes(32).toString("base64url")
  const listener = await listenForCallback()
  const url = authorizeUrl({ challenge, state, redirectUri: listener.redirectUri })
  openBrowser(url)

  const callback = (async () => {
    const result = await listener.result
    await listener.close()
    if (result.error) throw new Error(result.error)
    if (result.state !== state) throw new Error("Puku returned an unexpected OAuth state")
    if (!result.code) throw new Error("Puku did not return an authorization code")
    const tokens = await exchangeCode({ code: result.code, redirectUri: listener.redirectUri, verifier, state })
    return credential(tokens)
  })()
  // OpenCode awaits the credential once the browser reaches the callback. A
  // rejection before that point must not surface as an unhandled rejection.
  callback.catch(() => {})

  return {
    mode: "auto",
    url,
    instructions: "Complete the Puku sign-in in your browser. This window closes automatically.",
    callback,
  }
}

/** Renews an expired access token with the stored refresh token. */
async function refresh(value) {
  const tokens = await refreshAccessToken({ refresh: value.refresh })
  return credential(tokens)
}

export const PukuPlugin = {
  id: "opencode-puku",
  async setup(ctx) {
    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: PUKU.integrationID,
        method: { id: PUKU.oauthMethodID, type: "oauth", label: "Login with Puku" },
        authorize: () => authorize(),
        refresh: (value) => refresh(value),
      })
    })

    // The provider is published with the known models first, so a slow or
    // failing catalog call never leaves OpenCode without a Puku provider.
    let models = PUKU.fallbackModels.map(toModelInfo)

    await ctx.provider.transform((editor) => {
      editor.add({ info: providerInfo(), models })
    })

    const catalog = await listModels()
    models = catalog
    await ctx.provider.reload()
  },
}

export default PukuPlugin
