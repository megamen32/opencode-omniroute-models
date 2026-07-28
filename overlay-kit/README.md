# Roomhacker overlay kit

This kit keeps user-owned behavior out of upstream worktrees.

`manifest.json` is the compatibility contract. A patch-series component names one exact base commit and ordered patches. `verify` materializes an ephemeral worktree at that base and applies the series there. `build` clones a new managed artifact and applies the same series; it refuses to overwrite a destination.

## Lifecycle

```sh
node overlay-kit/scripts/overlay-kit.mjs plan
node overlay-kit/scripts/overlay-kit.mjs verify --component opencode-resilience-core --source /clean/opencode
node overlay-kit/scripts/overlay-kit.mjs verify --component openchamber-roomhacker-ui --source /clean/openchamber
node overlay-kit/scripts/overlay-kit.mjs build --component opencode-resilience-core --source /clean/opencode --destination /artifacts/opencode-next
```

Deploy only an artifact that passed verification. A service wrapper must point to one immutable `current` artifact, never to the forks in `apps/forks/`. Keep the previous artifact in place for rollback.

The provider plugin remains separate: it owns exact IDs, the `minimax/MiniMax-M3:512k` alias, catalog metadata, selector policy, and requested-versus-actual model telemetry. OpenChamber remains a UI consumer; it must not invent model limits or modalities.
