import test from "node:test"
import assert from "node:assert/strict"
import omniRoutePlugin from "../index.js"

test("preserves the auth hook from the OmniRoute base plugin", async () => {
  const hooks = await omniRoutePlugin({}, {})

  try {
    assert.equal(typeof hooks.auth, "object")
    assert.equal(hooks.auth.provider, "omniroute")
  } finally {
    await hooks.dispose()
  }
})
