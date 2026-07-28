import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { validateManifest } from "../overlay-kit/scripts/overlay-kit.mjs"

test("overlay manifest contains only complete, version-pinned patch series", () => {
  const manifest = JSON.parse(readFileSync(resolve("overlay-kit/manifest.json"), "utf8"))
  assert.equal(validateManifest(manifest), true)
  for (const component of manifest.components.filter((item) => item.kind === "git-am-series")) {
    assert.match(component.base, /^[0-9a-f]{40}$/)
    assert.ok(component.patches.length > 0)
  }
})
