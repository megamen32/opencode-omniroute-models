# Work: upstream-safe overlay kit

## Before Start

Description: Design and implement the first safe upgrade path for the user's OpenCode, OpenChamber, and OmniRoute customization. Preserve exact model IDs and actual-combo-model telemetry while making updates reproducible on clean upstream checkouts.

Severity: CORE

workflow: inventory(Lead) -> architecture(Lead + gpt-5.4-low Adviser) -> compatibility research(gpt-5.4-low Explorer) -> implementation(Workers) -> review(Critic) -> end-to-end verification(Lead) -> commit and deploy(Lead)

estimated min-max complete time: (min: 90m, max: 4h)

Acceptance:

- A versioned overlay manifest declares supported upstream revisions, patch anchors, install order, and rollback.
- Applying the kit to a clean supported checkout is idempotent and does not modify the upstream Git worktree.
- The runtime exposes the custom OmniRoute provider and exact `minimax/MiniMax-M3:512k` identity without display aliases.
- Existing resilience and actual-combo-model behavior has a verifiable extension/overlay boundary or an explicit, tested compatibility gap.
- A single documented command verifies active OpenCode/OpenChamber service ownership and the applied overlay version.

## On Start

Started: 2026-07-28 Europe/Moscow (UTC+3)

Executor: L (Lead)

Harness: Codex desktop

Session: current task

Next action: Review the completed MVP kit, then migrate the active services from source-fork execution to managed artifacts only after a clean upstream update passes the verify gate.

## Notes

- The platform exposes `gpt-5.4` but not an exact `gpt-5.4-mini` or `minimax/MiniMax-M3` subagent model. Delegated architecture work therefore uses explicit `gpt-5.4` with low reasoning; MiniMax-M3 remains a runtime/provider target, never an implied model substitution.
- Upstream worktrees currently contain unrelated untracked artifacts. They are outside this task's write scope.
- Architecture reports converge on the balanced MVP: plugin-first OpenCode features, declared OpenChamber overlays, and immutable deployment artifacts selected by systemd.
- Patch-series verification passed in clean temporary clones for OpenCode and OpenChamber.
- Latest upstream discovery: OpenCode `v1.18.9` and OpenChamber `v1.17.0` (both 2026-07-28); the OpenCode series applies cleanly to v1.18.9. The OpenChamber series conflicts at composer integration and is being ported in a separate Luna worktree before any deployment decision.
