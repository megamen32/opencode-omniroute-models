# OpenCode OmniRoute Models

An OpenCode plugin that exposes the complete live model catalog returned by an
OmniRoute OpenAI-compatible `/v1/models` endpoint.

It refreshes the catalog every five minutes by default, keeps model metadata
usable by OpenCode, and deliberately hides only `auto/*` and `best/*` routing
selectors. It does not replace or hard-code the OmniRoute model list.

## Install

```sh
npm install --prefix ~/.config/opencode git+https://github.com/megamen32/opencode-omniroute-models.git
```

Add the plugin to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-omniroute-models"]
}
```

The existing `omniroute` provider must point at the OmniRoute `/v1` endpoint.
The plugin reads its API key from OpenCode auth storage, so no key belongs in
the config file or repository.

## Configuration

Set `OPENCODE_OMNIROUTE_MODEL_TTL_MS` to change the refresh interval. The
default is `300000` milliseconds.

## Development

```sh
npm test
node --check index.js
```

The repository contains the provider plugin and small pure catalog tests. It
does not contain credentials, provider accounts, or a copy of the model list.
