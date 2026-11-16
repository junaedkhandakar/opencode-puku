# opencode-puku

Puku AI provider plugin for [OpenCode](https://opencode.ai). It signs in with Puku OAuth and exposes the Puku models.

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

## Sign in

Run `/connect`, choose **Puku**, then choose **Login with Puku**. The plugin opens
Puku's sign-in page in your browser and listens on a loopback port for the
redirect. OpenCode stores the returned credential and renews it automatically
when the access token expires.

## Models

The plugin reads the model catalog from Puku and publishes every model it
returns under the `puku` provider, for example `puku/puku-ai-2.8`. When the
catalog cannot be reached, the known Puku models are used instead, so the
provider never disappears from the model list.

Puku serves its models through an Anthropic-compatible API, so tool calls,
images and streaming behave like they do with the built-in Anthropic provider.

## Endpoints

| Endpoint                                                | Purpose                        |
| ------------------------------------------------------- | ------------------------------ |
| `https://puku.sh/api/oauth/authorize`                    | Browser sign-in                |
| `https://puku.sh/api/oauth/token`                        | Token exchange and renewal     |
| `https://api-cli.puku.sh/v1`                             | Anthropic-compatible inference |

Puku's OAuth server only accepts its registered `puku-cli` client, so the
plugin uses that client ID. Its redirect allowlist covers
`http://127.0.0.1:<port>/callback` for any port, which is why the callback
listener binds an ephemeral port.

## Development

```sh
npm test
```

The tests cover the OAuth helpers, the model catalog and the plugin
registration. They need Node 20 or newer and no network access.

## License

MIT
