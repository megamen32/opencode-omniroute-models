import test from "node:test"
import assert from "node:assert/strict"

import { captureRouteTelemetry, readRouteTelemetry, telemetryHeaders, wrapProviderFetch } from "../src/routeTelemetry.js"

test("captures the actual OmniRoute model and OpenCode session from response headers", () => {
  assert.deepEqual(readRouteTelemetry({
    "X-OmniRoute-Model": "minimax/MiniMax-M3",
    "X-OmniRoute-Session-ID": "ses_test",
  }), { model: "minimax/MiniMax-M3", sessionID: "ses_test" })
})

test("adds a session correlation header only for a valid session", () => {
  assert.deepEqual(telemetryHeaders("ses_test"), { "X-OmniRoute-Session-ID": "ses_test" })
  assert.deepEqual(telemetryHeaders(" "), {})
})

test("captures headers from the provider-specific fetch path", async () => {
  let requestHeaders
  const wrapped = wrapProviderFetch(async (_input, init) => {
    requestHeaders = new Headers(init?.headers)
    return new Response("ok", { headers: { "X-OmniRoute-Model": "minimax/MiniMax-M3:512k" } })
  })
  await wrapped("http://example.test", { headers: { "X-OmniRoute-Session-ID": "session-1" } })
  assert.equal(requestHeaders.get("X-OmniRoute-Session-ID"), "session-1")
  assert.deepEqual(captureRouteTelemetry({ "X-OmniRoute-Model": "minimax/MiniMax-M3:512k" }, requestHeaders), {
    model: "minimax/MiniMax-M3:512k",
    sessionID: "session-1",
  })
})
