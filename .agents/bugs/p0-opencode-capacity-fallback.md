# P0: capacity rejection has no user-visible fallback

- Observed: 2026-07-29 16:28 UTC+3, public mobile OpenCode UI.
- Symptom: `Chat admission capacity is temporarily unavailable. Retry shortly.` repeated through retry attempt 8 for `clinepass/DeepSeek V4 Pro`.
- Impact: users cannot send a message in the affected session.
- Confirmed boundary: the public UI is reachable; the failure is emitted after OmniRoute sends the request to a provider.
- Repair boundary: do not expose or copy credentials, restart active OpenCode/Codex sessions, or overwrite existing dirty files.
- Removal condition: delete this file only in the committed repair that includes regression and public end-to-end success evidence.
