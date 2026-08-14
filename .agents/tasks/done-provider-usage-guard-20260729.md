# Work: provider usage-window guard

## Before Start

Description: Implement an opt-in OmniRoute provider/account guard that applies configured usage-window policies before model selection, so Z.ai and Qoder can be paused before paid-overage routing. The policy must be deterministic, timezone-aware, reversible, and fail closed for protected selector exposure without changing billing settings.

Severity: CORE

workflow: architecture(Lead + Explorers) -> regression(Lead) -> implementation(Lead) -> review(Lead) -> verification(Lead) -> commit(Lead)

estimated min-max complete time: (min: 30m, max: 90m)

Acceptance:

- An explicit policy config supports named provider/account targets, IANA timezone, recurring high-usage windows, and enabled/dry-run state.
- Covered model selectors are absent while a target is blocked. Account restoration outside the window is opt-in because the current OmniRoute API lacks a conditional ownership update.
- The guard calls only a documented or explicitly configured local account-control adapter; unknown/missing control APIs make no runtime mutation.
- Z.ai and Qoder examples are documented and regression-tested, including a no-paid-overage failure path.

## On Start

started (UTC+3): 2026-07-29T00:00:00+03:00
Executor: L (Lead)
PID: current session
Harness: Codex desktop
session identifier: current task
Next action: completed; isolated implementation is ready for operator configuration and separately authorized deployment.

# Message layer

## Notes

- User-directed exception to the roadmap ordering: build the isolated policy now; do not deploy it into active upstream/runtime surfaces until the overlay compatibility contract is verified.
- The working tree contains unrelated overlay and generated changes. This task writes only its guard source, tests, README, roadmap, and task record.
- Critic review passed after two safety corrections: dry-run still hides covered selectors, and automatic restore is explicit opt-in because the OmniRoute API has no conditional ownership token.

## Blocker

none

# When complete

## Result

Implemented, not deployed.

- `src/usageWindowGuard.js` evaluates IANA-timezone pause windows (including cross-midnight), fails closed for invalid schedules/timezones, filters configured model prefixes, and reconciles exact account IDs through the live OmniRoute source-authoritative `PUT /api/providers/{id}` API with `{"isActive": boolean}`.
- `scripts/usage-window-guard.mjs` is the scheduler entrypoint. It defaults to `~/.config/omniroute/usage-window-guard.json`, reads management authentication only from `OMNIROUTE_USAGE_GUARD_API_KEY`, and persists only guard-owned account state (mode `0600`).
- The safe `restoreMode: "manual"` default never re-enables a paused account. `restoreMode: "always"` is explicitly opt-in for a scheduler that exclusively owns account state; the documented API has no compare-and-set ownership token.
- OpenCode integration hides the same configured prefixes during an active pause, including dry-run. It does not mutate accounts; the separately scheduled controller is the only mutation path.
- Evidence: `node --test test/usage-window-guard.test.js` passed 7/7; `npm test` passed 26/26; `node --check index.js src/usageWindowGuard.js scripts/usage-window-guard.mjs` passed; the example executed dry-run successfully without credentials or mutations.
- Live control endpoint was not called. Browser verification: `https://chat.z.ai/` loaded the public chat landing; `https://qoder.com/` loaded the public product landing.

## Completion checklist

- [x] Every selected workflow stage is complete or its omission is explained.
- [x] Acceptance is proven with exact commands, immutable artifacts, or paths.
- [x] Blockers are resolved or explicitly retained.
- [x] Result contains the full handoff and does not depend on a delivered agent message.
- [x] DO `git mv work-<id>.md done-<id>.md` and commit this file.
