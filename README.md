# OpenCode OmniRoute Models

An OpenCode plugin that exposes the complete live model catalog returned by an
OmniRoute OpenAI-compatible `/v1/models` endpoint.

It refreshes the catalog every five minutes by default, keeps model metadata
usable by OpenCode, and hides `auto/*` and `best/*` routing selectors by
default. It does not replace or hard-code the OmniRoute model list.

## Roomhacker custom features

- **Exact live IDs:** the catalog keeps provider/model IDs as selectable IDs,
  uses the full `opencode/<model>` spelling when both short and full aliases
  exist, and does not replace IDs with labels containing spaces.
- **Configured MiniMax alias:** `minimax/MiniMax-M3:512k` is exposed as an
  OpenCode model ID while routing the canonical `minimax/MiniMax-M3` upstream
  and advertising a 512,000-token input/context limit.
- **Selector switches:** `auto/*` and `best/*` are hidden by default and can
  be enabled with plugin options, provider options, or environment variables.
- **Actual combo-model telemetry:** provider responses are correlated to the
  OpenCode session through `X-OmniRoute-Session-ID`; when the route provides
  `X-OmniRoute-Model`, its actual model is captured and exposed at the
  loopback endpoint `http://127.0.0.1:20129/latest` for UI overlays.
- **OpenChamber targeted runtime patch:**
  `scripts/patch-openchamber-runtime.mjs --apply` replaces the bundled
  humanized model formatter with exact ID display, refusing to patch when the
  expected runtime helper is not found. It creates a backup before changing
  the asset.

Implementation: [`src/catalog.js`](src/catalog.js),
[`src/routeTelemetry.js`](src/routeTelemetry.js),
[`runtime/openchamber-actual-model.js`](runtime/openchamber-actual-model.js), and
[`scripts/patch-openchamber-runtime.mjs`](scripts/patch-openchamber-runtime.mjs).

When OmniRoute returns both `oc/<model>` and `opencode/<model>`, the plugin
keeps the full `opencode/<model>` spelling and removes the duplicate short
alias.

Displayed model names remain exact selectable IDs; the plugin does not replace
IDs with human-readable names containing spaces.

For the canonical `minimax/MiniMax-M3` entry, it also exposes
`minimax/MiniMax-M3:512k`. The alias sends the canonical model ID upstream but
limits OpenCode's advertised input/context window to 512,000 tokens.

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

Selector flags are disabled by default and can be set either in the OmniRoute
plugin tuple, provider options, or environment variables. For plugin-loader
options:

```jsonc
{
  "plugin": [
    ["opencode-omniroute-models", { "includeAuto": true, "includeBest": false }]
  ]
}
```

Provider-level options are also supported:

```jsonc
{
  "provider": {
    "omniroute": {
      "options": {
        "includeAuto": true,
        "includeBest": false
      }
    }
  }
}
```

Equivalent environment variables are `OPENCODE_OMNIROUTE_INCLUDE_AUTO` and
`OPENCODE_OMNIROUTE_INCLUDE_BEST` (`true`, `1`, `yes`, or `on`).

## Development

```sh
npm test
node --check index.js
```

The repository contains the provider plugin and small pure catalog tests. It
does not contain credentials, provider accounts, or a copy of the model list.
