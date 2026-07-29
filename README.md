# OpenCode OmniRoute Models

An OpenCode plugin that exposes the complete live model catalog returned by an
OmniRoute OpenAI-compatible `/v1/models` endpoint.

It refreshes the catalog every five minutes by default, keeps model metadata
usable by OpenCode, and hides `auto/*` and `best/*` routing selectors by
default. It does not replace or hard-code the OmniRoute model list.

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

### Paid-overage usage-window guard (Z.ai / Qoder)

The optional usage-window guard pauses exact **OmniRoute provider connections**
before a configured paid-overage period. It does not scrape vendor dashboards,
change a plan, or write OmniRoute SQLite directly. It uses OmniRoute's
management API only:

```text
PUT /api/providers/{connectionId}  {"isActive": false | true}
```

`connectionId` is the OmniRoute provider-connection ID, not a model ID or a
provider-node ID. The safe default, `restoreMode: "manual"`, leaves an account
paused after its window: this avoids overriding an operator's later manual
pause because OmniRoute's current update API has no conditional ownership
token. `restoreMode: "always"` opts into automatic re-enable after a window;
use it only when this scheduler is the sole owner of that account's active
state.

Copy [`examples/usage-window-guard.json`](examples/usage-window-guard.json) to
`~/.config/omniroute/usage-window-guard.json`, replace the placeholder
connection IDs and model prefixes, and first run a dry run:

```sh
node ~/.config/opencode/node_modules/opencode-omniroute-models/scripts/usage-window-guard.mjs
```

All `windows` are **pause windows** in the named IANA timezone. A window may
cross midnight. Invalid/missing schedule data fails closed for that policy; the
default `dryRun: true` makes no account mutations, but the OpenCode plugin
still hides a selector covered by an active pause window. After reviewing the
dry-run count, set `dryRun` to `false` and provide an OmniRoute management
credential only by environment reference:

```sh
export OMNIROUTE_USAGE_GUARD_API_KEY='from-your-secret-manager'
node ~/.config/opencode/node_modules/opencode-omniroute-models/scripts/usage-window-guard.mjs
```

Run that command once per minute with a user timer or another trusted scheduler.
The script persists only the IDs it disabled and their explicit restore mode in
`~/.local/state/omniroute/usage-window-guard.json` (mode `0600`). It never
stores a credential.

To make OpenCode hide the same selectors while an account is paused, put the
same `usageWindowGuard` object in the plugin tuple or `provider.omniroute.options`.
Provider-level options override plugin-tuple options. In active mode the plugin
also fails closed for the listed model prefixes while a policy is paused;
configure a separate safe fallback model. The scheduled controller is the only
component that changes account state, and it leaves accounts unchanged if
management authentication or the API update is unavailable.

For Z.ai GLM Coding Plan, the verified peak period is **14:00–18:00 UTC+8**:
that is **09:00–13:00 Europe/Moscow**. GLM-5.2 and GLM-5-Turbo cost 3x quota
there, so the example blocks only `glm/glm-5.2` and `glm/glm-5-turbo` during
that window. Check the current [Z.ai FAQ](https://docs.z.ai/devpack/faq) before
changing a production schedule.

Qoder's current public pricing is credits-per-billing-cycle, not a provider-wide
time multiplier; exhausted premium credits fall back to a basic model rather
than automatically purchasing more. Do not add a made-up Qoder time window.
Use Qoder's [Usage page](https://docs.qoder.com/account/pricing) and add a
threshold-based policy only when OmniRoute has an authoritative quota signal.
Neither provider exposes a public subscription-usage REST API, so this guard
intentionally relies on explicit time policy and OmniRoute's local account
state rather than unreliable account-site automation.

## Development

```sh
npm test
node --check index.js
```

The repository contains the provider plugin and small pure catalog tests. It
does not contain credentials, provider accounts, or a copy of the model list.
