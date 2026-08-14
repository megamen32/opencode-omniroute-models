import test from "node:test"
import assert from "node:assert/strict"

import { replaceExactModelDisplay } from "../scripts/patch-openchamber-runtime.mjs"

test("runtime patch prefers the exact model id in OpenChamber display helper", () => {
  const source = "const Q6=(t,e,n={})=>{const s=Vi(t?.name);if(s)return ef(s,n.maxLength);const o=Vi(t?.id)||Vi(e);return o?ef(gb(o),n.maxLength):n.fallbackLabel??\"\"}"
  const patched = replaceExactModelDisplay(source)

  assert.match(patched, /const Q6=\(t,e,n=\{\}\)=>\{const o=Vi\(t\?\.id\)\|\|Vi\(e\)/)
  assert.doesNotMatch(patched, /const const Q6/)
  assert.doesNotMatch(patched, /const s=Vi\(t\?\.name\)/)
  assert.equal(replaceExactModelDisplay(patched), patched)
})
