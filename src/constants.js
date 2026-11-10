// Shared Puku endpoints and identifiers for the OpenCode plugin.

export const PUKU = {
  /** Provider ID used in model references such as `puku/puku-ai-2.8`. */
  providerID: "puku",
  /** Integration ID that owns the stored Puku credentials. */
  integrationID: "puku",
  /** Method ID of the browser OAuth sign-in. */
  oauthMethodID: "puku-oauth",
  /**
   * OAuth client registered by the Puku CLI. Puku's OAuth server rejects every
   * other client ID, so the plugin borrows this client's identity.
   */
  clientID: "puku-cli",
  authorizeUrl: "https://puku.sh/api/oauth/authorize",
  tokenUrl: "https://puku.sh/api/oauth/token",
  /** Mints a long-lived API key from an OAuth access token. */
  apiKeyUrl: "https://puku.sh/api/oauth/puku_cli/create_api_key",
  /** Anthropic-compatible inference API. */
  apiBase: "https://api-cli.puku.sh/v1",
  /** Runtime package that speaks the Anthropic Messages protocol. */
  package: "@opencode/ai/providers/anthropic-compatible",
  /** `user:inference` allows inference, `user:profile` identifies the account. */
  scopes: ["user:profile", "user:inference"],
  /** Puku caps output at 8192 tokens for every model it serves. */
  outputLimit: 8_192,
  contextLimit: 200_000,
  modelNames: {
    "puku-ai-2.8": "Puku AI 2.8",
    "puku-ai-2.7": "Puku AI 2.7",
  },
  fallbackModels: ["puku-ai-2.8", "puku-ai-2.7"],
}
