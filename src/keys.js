// Mints the long-lived API key that Puku's inference API expects.
//
// The OAuth access token only opens the account's settings. The inference API
// wants a separate key, sent as `x-api-key`, so the sign-in flow trades the
// access token for one.

import { PUKU } from "./constants.js"

/**
 * Exchanges an OAuth access token for a Puku API key. The key is the value the
 * inference API accepts in its `x-api-key` header.
 */
export async function createApiKey(accessToken) {
  if (!accessToken) throw new Error("Puku needs an access token to create an API key")
  const response = await fetch(PUKU.apiKeyUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Puku could not create an API key (${response.status})`)
  const body = await response.json().catch(() => undefined)
  // Puku names the field `raw_key`; the other spellings are accepted as a
  // fallback so a rename on their side does not break the sign-in.
  const key = body?.raw_key ?? body?.api_key ?? body?.apiKey ?? body?.key
  if (typeof key !== "string" || !key) throw new Error("Puku did not return an API key")
  return key
}
