# opencode-puku

Puku AI provider plugin for [OpenCode](https://opencode.ai). It registers Puku
as a native OpenCode integration and as a provider, so the Puku models show up
as `puku/<model-id>`, for example `puku/puku-ai-2.8`.

Puku has no entry in the models.dev catalog, so the plugin registers the
provider itself. The credential lives in OpenCode's own credential store.

## Install

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-puku"]
}
```

Or install it globally:

```sh
opencode plugin add opencode-puku
```

A local checkout works too — point the config at its directory:

```jsonc
{
  "plugins": ["D:/puku-opencode"]
}
```

## Sign in

Puku is a native integration, so OpenCode's own auth flow signs in:

```sh
opencode auth login puku
```

Two methods are offered:

| Method  | Credential                  | Sent to Puku as                 |
| ------- | --------------------------- | ------------------------------- |
| Browser | OAuth access token          | `Authorization: Bearer <token>` |
| API key | A Puku API key you paste in | `x-api-key: <key>`              |

The browser method runs Puku's OAuth + PKCE flow: the plugin opens the sign-in
page, listens on a loopback port for the redirect, exchanges the authorization
code for an access and refresh token, and hands both to OpenCode. OpenCode then
refreshes the token on its own when it expires.

The API-key method takes a key you already have. Puku's own CLI uses the same
two header shapes, so both work against the inference API.

### Commands

| Command        | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `/puku-login`  | Starts the sign-in and reports whether it finished.  |
| `/puku-status` | Reports whether the account is connected, and models. |

### Headless machines

Set `PUKU_OPEN_BROWSER=0` so the plugin does not try to open a browser, then
open the URL the command prints yourself.

## Models

The plugin reads the model catalog from `GET https://api-cli.puku.sh/v1/models`
and publishes every model it returns under the `puku` provider. When the
catalog cannot be reached, the known Puku models are used instead, so the
provider never disappears from the model list.

Puku serves its models through an Anthropic-compatible API, so tool calls,
images and streaming behave like they do with the built-in Anthropic provider.
Puku caps every model at 8192 output tokens.

The provider sends `anthropic-beta: oauth-2025-04-20`, the beta flag Puku's own
CLI sends. The Anthropic runtime merges this with the betas it needs itself.

## Configuration

| Variable              | Purpose                                   |
| --------------------- | ----------------------------------------- |
| `PUKU_OPEN_BROWSER=0` | Do not open a browser during the sign-in. |

## Endpoints

| Endpoint                                   | Purpose                     |
| ------------------------------------------ | --------------------------- |
| `https://chat.puku.sh/api/oauth/authorize` | Browser sign-in             |
| `https://puku.sh/api/oauth/token`          | Token exchange and renewal  |
| `https://api-cli.puku.sh/v1`                | Anthropic-compatible API    |

The inference base URL is the `/v1` prefix and the runtime appends `/messages`
to it.

Puku's OAuth server only accepts its registered clients, so the plugin borrows
the client ID of Puku's own CLI. Its redirect allowlist covers
`http://127.0.0.1:<port>/callback` and `http://localhost:<port>/callback` for
the ports 3118 to 3137 only, so the callback listener walks that range and takes
the first free port.

The token endpoint only reads a form-encoded body, so the code exchange and the
refresh both send `application/x-www-form-urlencoded`.

## Development

```sh
npm test
```

The tests cover the PKCE helpers, the authorization URL, the callback listener,
the token exchange, the model catalog and the plugin's registration, commands
and credential handling. They need Node 20 or newer. The suite runs without
network access; one test reads Puku's published client metadata and is skipped
when that is unreachable.

## License

MIT
