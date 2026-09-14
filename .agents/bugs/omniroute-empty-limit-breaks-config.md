# Bug: empty OmniRoute model limit breaks OpenCode global config

Severity: P0_URGENT

Confirmed: 2026-07-28 UTC+3

Observed behavior: a live catalog model without authoritative context/output metadata is projected with `limit: {}`. OpenCode rejects that object while serving global configuration; downstream OpenChamber then falls back to zero-valued resilience settings.

Failure boundary: plugin metadata projection in `src/catalog.js` and configuration consumption in OpenCode/OpenChamber.

Required repair:

- Omit `limit` unless the emitted shape satisfies the target OpenCode schema.
- Add a regression fixture for an unknown live model and a configuration-schema acceptance test.
- Make the UI distinguish unavailable config from an effective zero.

Status: open; blocks reliable deployment of the overlay kit.
