// Shared Puku endpoints and identifiers for the OpenCode plugin.

export const PUKU = {
  /** Provider ID used in model references such as `puku/puku-ai-2.8`. */
  providerID: "puku",
  /**
   * OAuth client registered by the Puku CLI. Puku's OAuth server rejects every
   * other client ID, so the plugin borrows this client's identity.
   */
  clientID: "puku-cli",
  authorizeUrl: "https://puku.sh/api/oauth/authorize",
  tokenUrl: "https://puku.sh/api/oauth/token",
  /** Mints a long-lived API key from an OAuth access token. */
  apiKeyUrl: "https://puku.sh/api/oauth/puku_cli/create_api_key",
  /** Anthropic-compatible inference API. The runtime appends `/messages` to it. */
  apiBase: "https://api-cli.puku.sh/v1",
  /** Runtime package that speaks the Anthropic Messages protocol. */
  package: "@opencode/ai/providers/anthropic-compatible",
  /**
   * Loopback ports Puku accepts as an OAuth redirect. The allowlist comes from
   * https://puku.sh/oauth/puku-cli-client-metadata and is fixed: a redirect to
   * any other port is rejected when the authorization code is exchanged.
   */
  callbackPorts: Array.from({ length: 20 }, (_, index) => 3118 + index),
  /** Host of the callback listener. The allowlist covers 127.0.0.1 as well. */
  callbackHost: "127.0.0.1",
  /**
   * `org:create_api_key` mints the inference key, `user:profile` identifies the
   * account and `user:inference` allows inference.
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
