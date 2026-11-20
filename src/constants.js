// Shared Puku endpoints and identifiers for the OpenCode plugin.

export const PUKU = {
  /** Provider ID used in model references such as `puku/puku-ai-2.8`. */
  providerID: "puku",
  /**
   * Integration ID of the native OpenCode integration. OpenCode stores the
   * credential under this ID and shows the integration in `opencode auth`.
   */
  integrationID: "puku",
  /**
   * Method ID of the OAuth sign-in method. The key method has no ID: a key
   * method is identified by its type.
   */
  oauthMethodID: "browser",
  /**
   * OAuth client of Puku's own CLI. The plugin borrows this client's identity,
   * so the redirect URIs it registered stay valid.
   */
  clientID: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  /** Puku AI's sign-in page. */
  authorizeUrl: "https://chat.puku.sh/api/oauth/authorize",
  /** Mints a long-lived API key from an OAuth access token. */
  apiKeyUrl: "https://puku.sh/api/oauth/puku_cli/create_api_key",
  /** Anthropic-compatible inference API. The runtime appends `/messages` to it. */
  apiBase: "https://api-cli.puku.sh/v1",
  /**
   * Beta flag Puku's own CLI sends with every OAuth-authenticated request.
   * The Anthropic runtime merges this with the betas it needs itself.
   */
  anthropicBeta: "oauth-2025-04-20",
  /** Runtime package that speaks the Anthropic Messages protocol. */
  package: "@opencode/ai/providers/anthropic-compatible",
  /**
   * Loopback ports Puku accepts as an OAuth redirect. The allowlist comes from
   * https://puku.sh/oauth/puku-cli-client-metadata and is fixed: a redirect to
   * any other port is rejected when the authorization code is exchanged.
   */
  callbackPorts: Array.from({ length: 20 }, (_, index) => 3118 + index),
  /**
   * Host of the callback listener. `127.0.0.1` is an IPv4 literal, so it never
   * resolves to an address family the listener missed; Puku's allowlist covers
   * it as well as `localhost`.
   */
  callbackHost: "127.0.0.1",
  /**
   * `user:inference` allows inference, `user:profile` identifies the account
   * and `org:create_api_key` lets the account mint an inference key. These are
   * the scopes Puku's own CLI asks for.
   */
  scopes: ["org:create_api_key", "user:profile", "user:inference"],
  /** Puku caps output at 8192 tokens for every model it serves. */
  outputLimit: 8_192,
  contextLimit: 200_000,
  modelNames: {
    "puku-ai-2.8": "Puku AI 2.8",
    "puku-ai-2.7": "Puku AI 2.7",
    "claude-opus-4-8": "Claude Opus 4.8",
  },
  fallbackModels: ["puku-ai-2.8", "puku-ai-2.7", "claude-opus-4-8"],
}
