# Roomhacker overlay kit

This kit keeps user-owned behavior out of upstream worktrees.

`manifest.json` is the compatibility contract. A patch-series component names one exact base commit, ordered patches, and a SHA-256 hash for every patch. `verify` materializes an ephemeral worktree at that base and applies the series there. `build` stages a new artifact and atomically publishes it only after the patch series succeeds; it never overwrites an existing destination.

## Lifecycle

```sh
node overlay-kit/scripts/overlay-kit.mjs plan
node overlay-kit/scripts/overlay-kit.mjs verify --component opencode-resilience-core --source /clean/opencode
node overlay-kit/scripts/overlay-kit.mjs verify --component openchamber-roomhacker-ui --source /clean/openchamber
node overlay-kit/scripts/overlay-kit.mjs build --component opencode-resilience-core --source /clean/opencode --destination /artifacts/opencode-next
node overlay-kit/scripts/overlay-kit.mjs doctor --root /srv/roomhacker-ai
node overlay-kit/scripts/overlay-kit.mjs deploy --root /srv/roomhacker-ai --artifact opencode-next
node overlay-kit/scripts/overlay-kit.mjs rollback --root /srv/roomhacker-ai --artifact opencode-previous
```

`doctor`, `deploy`, and `rollback` operate only on a directory containing the literal `.roomhacker-overlay-root` marker. Artifacts must be direct children of that root and contain `.roomhacker-overlay.json`. `deploy` switches the `current` symlink atomically; rollback is the same safe switch to a retained prior artifact. The CLI intentionally does not execute `plugin` or `runtime-patch` manifest entries: those remain declarative until dedicated handlers and acceptance tests exist.

The provider plugin remains separate: it owns exact IDs, the `minimax/MiniMax-M3:512k` alias, catalog metadata, selector policy, and requested-versus-actual model telemetry. OpenChamber remains a UI consumer; it must not invent model limits or modalities.
