# opencode-puku

Puku AI provider plugin for [OpenCode](https://opencode.ai). It signs in to Puku
AI with OAuth and exposes the Puku models as `puku/<model-id>`, for example
`puku/puku-ai-2.8`.

Puku has no entry in the models.dev catalog, so the plugin registers the
provider itself instead of attaching a method to an existing integration.

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

Run `/puku-signin` in OpenCode. The plugin opens Puku's sign-in page in your
browser, listens on a loopback port for the redirect, mints an API key from the
OAuth access token and stores it in OpenCode's plugin storage. The provider is
reloaded right away, so the models work in the same session.

`/puku-signout` removes the stored key again.

On a headless machine the browser cannot be opened. Set `PUKU_OPEN_BROWSER=0`
and open the URL the command prints instead.

## Models

The plugin reads the model catalog from `GET https://api-cli.puku.sh/v1/models`
and publishes every model it returns under the `puku` provider. When the
catalog cannot be reached, the known Puku models are used instead, so the
provider never disappears from the model list.

Puku serves its models through an Anthropic-compatible API, so tool calls,
images and streaming behave like they do with the built-in Anthropic provider.
Puku caps every model at 8192 output tokens.

## Configuration

| Variable              | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `PUKU_AI_API_KEY`     | Puku API key. Overrides the stored key when OpenCode starts.     |
| `PUKU_API_KEY`        | Same, the name the Puku CLI uses.                                |
| `PUKU_OPEN_BROWSER=0` | Do not open a browser during the sign-in.                        |

## Endpoints

| Endpoint                                             | Purpose                     |
| ---------------------------------------------------- | --------------------------- |
| `https://puku.sh/api/oauth/authorize`                 | Browser sign-in             |
| `https://puku.sh/api/oauth/token`                     | Token exchange and renewal  |
| `https://puku.sh/api/oauth/puku_cli/create_api_key`   | Mints the inference key     |
| `https://api-cli.puku.sh/v1`                          | Anthropic-compatible API    |

The key is sent as `x-api-key`, so the base URL is the `/v1` prefix and the
runtime appends `/messages` to it.

Puku's OAuth server only accepts its registered `puku-cli` client, so the plugin
uses that client ID. Its redirect allowlist covers
`http://127.0.0.1:<port>/callback` and `http://localhost:<port>/callback` for
the ports 3118 to 3137 only, so the callback listener walks that range and
takes the first free port.

## Development

```sh
npm test
```

The tests cover the OAuth helpers, the model catalog, the key minting and the
plugin registration. They need Node 20 or newer and no network access.

## License

MIT
