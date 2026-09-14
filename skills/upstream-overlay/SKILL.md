---
name: upstream-overlay
description: Safely update OpenCode and OpenChamber while reapplying the Roomhacker OmniRoute features as version-pinned overlays and deployed artifacts.
---

# Upstream overlay update

Use this skill whenever updating OpenCode, OpenChamber, or the Roomhacker OmniRoute integration.

## Rules

- Do not merge user features into an upstream checkout by hand.
- Do not patch a running service or an upstream Git worktree in place.
- Keep requested model, actual responder, and combo effective limits as separate raw-ID fields.
- Fail closed: an unknown version, missing anchor, invalid config schema, or failed smoke test blocks deployment.
- Preserve unrelated changes and never print secrets.

## Workflow

1. Record upstream revisions and inspect the active artifacts and service wrappers.
2. Run `node overlay-kit/scripts/overlay-kit.mjs plan`.
3. For every selected patch-series component, run `verify` against a clean upstream clone. It creates an ephemeral Git worktree and leaves the source untouched.
4. Build each verified component into a new managed artifact with `build --destination <new-artifact-dir>`.
5. Install the OpenCode provider plugin and apply OpenChamber runtime patches only to the built/deployed artifact.
6. Verify: OpenCode config roundtrip, provider visibility, exact `minimax/MiniMax-M3:512k` ID, actual-model telemetry, and OpenChamber UI controls.
7. Atomically point the service wrapper at the new artifact. Keep the previous artifact for rollback.

## Commands

```sh
node overlay-kit/scripts/overlay-kit.mjs plan
node overlay-kit/scripts/overlay-kit.mjs verify --component opencode-resilience-core --source /path/to/clean/opencode
node overlay-kit/scripts/overlay-kit.mjs build --component opencode-resilience-core --source /path/to/clean/opencode --destination /path/to/artifacts/opencode-next
```

The current supported revisions are intentionally exact hashes in `overlay-kit/manifest.json`; add a new compatibility row only after the verify gate passes.
