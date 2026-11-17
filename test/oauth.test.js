import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"

import { PUKU } from "../src/constants.js"
import { authorizeUrl, exchangeCode, listenForCallback, openBrowser, pkce } from "../src/oauth.js"

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

test("pkce derives a verifier and its challenge", () => {
  const { verifier, challenge } = pkce()
  assert.ok(verifier.length > 0)
  assert.ok(challenge.length > 0)
  assert.notEqual(verifier, challenge)
  assert.doesNotMatch(verifier, /[+/=]/)
  assert.doesNotMatch(challenge, /[+/=]/)
})

test("authorizeUrl asks Puku for a PKCE authorization code", () => {
  const url = new URL(
    authorizeUrl({
      challenge: "the-challenge",
      state: "the-state",
      redirectUri: "http://127.0.0.1:3118/callback",
    }),
  )
  assert.equal(url.origin + url.pathname, PUKU.authorizeUrl)
  assert.equal(url.searchParams.get("client_id"), "puku-cli")
  assert.equal(url.searchParams.get("response_type"), "code")
  assert.equal(url.searchParams.get("code_challenge"), "the-challenge")
  assert.equal(url.searchParams.get("code_challenge_method"), "S256")
  assert.equal(url.searchParams.get("state"), "the-state")
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:3118/callback")
  assert.equal(url.searchParams.get("scope"), PUKU.scopes.join(" "))
  assert.equal(url.searchParams.get("code"), "true")
})

test("the scopes can mint an API key and allow inference", () => {
  assert.ok(PUKU.scopes.includes("org:create_api_key"))
  assert.ok(PUKU.scopes.includes("user:inference"))
})

test("listenForCallback binds a port of Puku's redirect allowlist", async () => {
  const listener = await listenForCallback()
  try {
    const redirect = new URL(listener.redirectUri)
    assert.equal(redirect.hostname, PUKU.callbackHost)
    assert.equal(redirect.pathname, "/callback")
    assert.ok(PUKU.callbackPorts.includes(Number(redirect.port)))
  } finally {
    await listener.close()
  }
})

test("listenForCallback skips a port that is already in use", async () => {
  const busy = createServer()
  await new Promise((resolve) => busy.listen(PUKU.callbackPorts[0], PUKU.callbackHost, resolve))
  try {
    const listener = await listenForCallback()
    try {
      const redirect = new URL(listener.redirectUri)
      assert.notEqual(Number(redirect.port), PUKU.callbackPorts[0])
      assert.ok(PUKU.callbackPorts.includes(Number(redirect.port)))
    } finally {
      await listener.close()
    }
  } finally {
    await new Promise((resolve) => busy.close(resolve))
  }
})

test("listenForCallback receives the authorization code", async () => {
  const listener = await listenForCallback()
  try {
    const response = await fetch(`${listener.redirectUri}?code=the-code&state=the-state`)
    assert.equal(response.status, 200)

    const result = await listener.result
    assert.equal(result.code, "the-code")
    assert.equal(result.state, "the-state")
    assert.equal(result.error, null)
  } finally {
    await listener.close()
  }
})

test("listenForCallback reports an OAuth error", async () => {
  const listener = await listenForCallback()
  try {
    const response = await fetch(`${listener.redirectUri}?error=access_denied`)
    assert.equal(response.status, 400)

    const result = await listener.result
    assert.equal(result.error, "access_denied")
    assert.equal(result.code, null)
  } finally {
    await listener.close()
  }
})

test("listenForCallback answers an unknown path with a 404", async () => {
  const listener = await listenForCallback()
  try {
    const response = await fetch(listener.redirectUri.replace("/callback", "/other"))
    assert.equal(response.status, 404)
  } finally {
    await listener.close()
  }
})

test("exchangeCode sends the authorization code as Puku's CLI sends it", async () => {
  const attempts = []
  await withFetch(
    async (url, init) => {
      attempts.push({ url: String(url), init })
      // The form encoding is refused, so the JSON body is used.
      if (init.headers["content-type"] === "application/x-www-form-urlencoded") {
        return new Response("{}", { status: 400 })
      }
      return new Response(
        JSON.stringify({ access_token: "the-access", refresh_token: "the-refresh", expires_in: 3600 }),
        { headers: { "content-type": "application/json" } },
      )
    },
    async () => {
      const tokens = await exchangeCode({
        code: "the-code",
        redirectUri: "http://127.0.0.1:3118/callback",
        verifier: "the-verifier",
        state: "the-state",
      })
      assert.equal(tokens.access, "the-access")
      assert.equal(tokens.refresh, "the-refresh")
      assert.ok(tokens.expires > Date.now())
    },
  )

  assert.equal(attempts.length, 2)
  assert.equal(attempts[0].url, PUKU.tokenUrl)
  assert.equal(attempts[0].init.method, "POST")

  const form = new URLSearchParams(attempts[0].init.body)
  assert.equal(form.get("grant_type"), "authorization_code")
  assert.equal(form.get("code"), "the-code")
  assert.equal(form.get("redirect_uri"), "http://127.0.0.1:3118/callback")
  assert.equal(form.get("client_id"), "puku-cli")
  assert.equal(form.get("code_verifier"), "the-verifier")
  assert.equal(form.get("state"), "the-state")

  assert.equal(attempts[1].url, PUKU.tokenUrl)
  assert.equal(attempts[1].init.headers["content-type"], "application/json")
  const body = JSON.parse(attempts[1].init.body)
  assert.deepEqual(body, {
    grant_type: "authorization_code",
    code: "the-code",
    redirect_uri: "http://127.0.0.1:3118/callback",
    client_id: "puku-cli",
    code_verifier: "the-verifier",
    state: "the-state",
  })
})

test("openBrowser can be turned off for headless setups", () => {
  const original = process.env.PUKU_OPEN_BROWSER
  process.env.PUKU_OPEN_BROWSER = "0"
  try {
    assert.doesNotThrow(() => openBrowser("https://puku.sh/login"))
  } finally {
    if (original === undefined) delete process.env.PUKU_OPEN_BROWSER
    else process.env.PUKU_OPEN_BROWSER = original
  }
})
