# P0: restore OpenCode messages when a routed provider is capacity-rejected

- Description: The public OpenCode/OpenChamber client reports `Chat admission capacity is temporarily unavailable` for a routed ClinePass DeepSeek request and loops retries.
- Severity: P0
- Started: 2026-07-29 16:36 UTC+3
- Executor: L
- Harness: Codex session
- Workflow:
  1. L — capture public/UI, ingress, backend, and provider-route evidence.
  2. L — locate the smallest independent fallback path and create a failing regression.
  3. L — implement and deploy only the selected fallback; preserve active sessions and unrelated dirty work.
  4. L — prove a public user-relevant request succeeds and records the actual route.
- Required time: 20-60 minutes
- Acceptance: a message submitted through https://opencode.bezrabotnyi.com succeeds while the capacity-rejected provider remains unavailable, and the successful backend/model is recorded without exposing credentials.
- Non-proof: listener status, a build, a local-only curl, or a retry timer alone.
- Next action: determine the authenticated live OmniRoute response and the configured independent fallback.
