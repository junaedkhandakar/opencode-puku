import assert from "node:assert/strict"
import { test } from "node:test"

import { PUKU } from "../src/constants.js"
import { authorizeUrl, listenForCallback, pkce } from "../src/oauth.js"

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
      redirectUri: "http://127.0.0.1:1234/callback",
    }),
  )
  assert.equal(url.origin + url.pathname, PUKU.authorizeUrl)
  assert.equal(url.searchParams.get("client_id"), PUKU.clientID)
  assert.equal(url.searchParams.get("response_type"), "code")
  assert.equal(url.searchParams.get("code_challenge"), "the-challenge")
  assert.equal(url.searchParams.get("code_challenge_method"), "S256")
  assert.equal(url.searchParams.get("state"), "the-state")
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:1234/callback")
  assert.equal(url.searchParams.get("scope"), PUKU.scopes.join(" "))
})

test("listenForCallback binds a loopback listener on an ephemeral port", async () => {
  const listener = await listenForCallback()
  try {
    const redirect = new URL(listener.redirectUri)
    assert.equal(redirect.hostname, "127.0.0.1")
    assert.equal(redirect.pathname, "/callback")
    assert.ok(Number(redirect.port) > 0)
  } finally {
    await listener.close()
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
