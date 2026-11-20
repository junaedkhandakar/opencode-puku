// Puku OAuth 2.0 + PKCE sign-in for the OpenCode plugin.
//
// Puku's OAuth server only accepts the registered `puku-cli` client, so the
// plugin borrows that client's identity. Its redirect allowlist is fixed and
// covers http://127.0.0.1:<port>/callback and http://localhost:<port>/callback
// for the ports in PUKU.callbackPorts only, so the loopback listener walks
// that range and takes the first free port.

import { createHash, randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { createServer } from "node:http"

import { PUKU } from "./constants.js"

export function pkce() {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

export function authorizeUrl({ challenge, state, redirectUri, scopes = PUKU.scopes }) {
  const url = new URL(PUKU.authorizeUrl)
  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", PUKU.clientID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", scopes.join(" "))
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)
  return url.toString()
}

/**
 * Starts the loopback callback listener and resolves with the redirect URL and
 * the received authorization code. When `expectedState` is given, a callback
 * carrying a different state came from an older sign-in tab: it is answered
 * with an explanation and ignored, and the listener keeps waiting for the
 * current attempt instead of failing the whole sign-in.
 */
// The window has to cover reading the page and signing in by hand, so it is
// generous; PUKU_SIGNIN_TIMEOUT_MS can shorten or extend it.
const DEFAULT_TIMEOUT_MS = Number(process.env.PUKU_SIGNIN_TIMEOUT_MS) > 0 ? Number(process.env.PUKU_SIGNIN_TIMEOUT_MS) : 900_000

export async function listenForCallback({ timeoutMs = DEFAULT_TIMEOUT_MS, expectedState } = {}) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/callback") {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" })
      response.end("<!doctype html><meta charset=\"utf-8\"><p>Not found.</p>")
      return
    }
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const error = url.searchParams.get("error")
    if (expectedState && state !== expectedState) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" })
      response.end(
        `<!doctype html><meta charset="utf-8"><title>Puku</title>` +
          `<body style="font-family:system-ui;padding:40px">` +
          `<h2>This sign-in tab is out of date</h2>` +
          `<p>Close it and finish the newest Puku sign-in tab instead.</p>` +
          `</body>`,
      )
      return
    }
    response.writeHead(error ? 400 : 200, { "content-type": "text/html; charset=utf-8" })
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Puku</title>` +
        `<body style="font-family:system-ui;padding:40px">` +
        (error
          ? `<h2>Sign-in failed</h2><p>${escapeHtml(error)}</p>`
          : `<h2>Puku is connected</h2><p>You can close this tab and return to OpenCode.</p>`) +
        `</body>`,
    )
    if (!settled) {
      settled = true
      resolve({ code, state, error })
    }
  })

  let resolve
  let settled = false
  const result = new Promise((r) => {
    resolve = r
  })

  const port = await bind(server)
  const redirectUri = `http://${PUKU.callbackHost}:${port}/callback`
  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true
      resolve({ code: null, state: null, error: "Timed out waiting for the Puku sign-in" })
    }
  }, timeoutMs)
  timeout.unref?.()

  return {
    redirectUri,
    result,
    close: () =>
      new Promise((done) => {
        clearTimeout(timeout)
        server.closeAllConnections?.()
        server.close(() => done())
      }),
  }
}

/**
 * Binds the first free port of Puku's redirect allowlist. The ports are fixed,
 * so a busy one is skipped instead of failing the sign-in.
 */
async function bind(server) {
  // The listener must not keep the OpenCode server alive if the attempt is cancelled.
  server.unref?.()
  let failure
  for (const port of PUKU.callbackPorts) {
    try {
      await listen(server, port)
      return port
    } catch (error) {
      // Another process already holds this port; the allowlist has twenty of them.
      if (error?.code !== "EADDRINUSE") throw error
      failure = error
    }
  }
  const first = PUKU.callbackPorts[0]
  const last = PUKU.callbackPorts[PUKU.callbackPorts.length - 1]
  throw new Error(`No free Puku callback port between ${first} and ${last}`, { cause: failure })
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("error", onError)
      reject(error)
    }
    server.once("error", onError)
    server.listen(port, PUKU.callbackHost, () => {
      server.removeListener("error", onError)
      resolve()
    })
  })
}

/** Exchanges an authorization code for access and refresh tokens. */
export async function exchangeCode({ code, redirectUri, verifier, state }) {
  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: PUKU.clientID,
    code_verifier: verifier,
    state,
  }
  const tokens = await postToken([
    { url: PUKU.tokenUrl, body, encoding: "form" },
    { url: PUKU.tokenUrl, body, encoding: "json" },
  ])
  if (!tokens.access_token) throw new Error("Puku did not return an access token")
  return {
    access: tokens.access_token,
    refresh: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
    expires: Date.now() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000,
  }
}

/** Refreshes an access token with the stored refresh token. */
export async function refreshAccessToken({ refresh }) {
  const body = {
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: PUKU.clientID,
    scope: PUKU.scopes.join(" "),
  }
  const tokens = await postToken([
    { url: PUKU.tokenUrl, body, encoding: "form" },
    { url: PUKU.tokenUrl, body, encoding: "json" },
  ])
  if (!tokens.access_token) throw new Error("Puku did not return an access token")
  return {
    access: tokens.access_token,
    refresh: typeof tokens.refresh_token === "string" ? tokens.refresh_token : refresh,
    expires: Date.now() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000,
  }
}

/**
 * Posts to the token endpoint until one encoding is accepted. Puku's endpoint
 * only reads a form body; the JSON body is kept as a fallback in case that
 * changes.
 */
async function postToken(attempts) {
  let failure
  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      method: "POST",
      headers:
        attempt.encoding === "form"
          ? { "content-type": "application/x-www-form-urlencoded" }
          : { "content-type": "application/json" },
      body:
        attempt.encoding === "form" ? new URLSearchParams(attempt.body).toString() : JSON.stringify(attempt.body),
    })
    const parsed = await readJson(response)
    if (response.ok && parsed?.access_token) return parsed
    failure = `Puku token request failed (${response.status}): ${describe(parsed)}`
  }
  throw new Error(failure ?? "Puku token request failed")
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

const describe = (body) => {
  const detail = body?.error_description ?? body?.error
  return typeof detail === "string" ? detail.slice(0, 200) : "unknown error"
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])

/** Opens the browser on the sign-in page. A failure is not fatal: the URL is shown to the user. */
export function openBrowser(url) {
  // Headless setups can turn the launch off and open the URL by hand.
  if (process.env.PUKU_OPEN_BROWSER === "0") return
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref()
      return
    }
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref()
      return
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref()
  } catch {
    // The URL is printed by the caller, so a failed browser launch is not fatal.
  }
}
