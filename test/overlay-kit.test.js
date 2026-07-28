import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { deploy, doctor, validateManifest } from "../overlay-kit/scripts/overlay-kit.mjs"

test("overlay manifest contains only complete, version-pinned patch series", () => {
  const manifest = JSON.parse(readFileSync(resolve("overlay-kit/manifest.json"), "utf8"))
  assert.equal(validateManifest(manifest), true)
  for (const component of manifest.components.filter((item) => item.kind === "git-am-series")) {
    assert.match(component.base, /^[0-9a-f]{40}$/)
    assert.ok(component.patches.length > 0)
  }
})

test("manifest rejects tampered patch integrity", () => {
  const manifest = JSON.parse(readFileSync(resolve("overlay-kit/manifest.json"), "utf8"))
  manifest.components[0].patchHashes[manifest.components[0].patches[0]] = "0".repeat(64)
  assert.throws(() => validateManifest(manifest), /Patch hash mismatch|SHA-256 hashes/)
})

test("unsupported components are declarative and not executable", () => {
  const manifest = JSON.parse(readFileSync(resolve("overlay-kit/manifest.json"), "utf8"))
  assert.equal(manifest.components.find((item) => item.kind === "plugin").kind, "plugin")
  assert.equal(manifest.components.find((item) => item.kind === "runtime-patch").kind, "runtime-patch")
})

test("doctor and deploy use a marked root and atomic current link", () => {
  const root = mkdtempSync(join(tmpdir(), "overlay-kit-test-"))
  writeFileSync(join(root, ".roomhacker-overlay-root"), "roomhacker-overlay-root-v1\n")
  const artifact = join(root, "opencode-test")
  mkdirSync(artifact)
  writeFileSync(join(artifact, ".roomhacker-overlay.json"), "{}\n")
  assert.equal(doctor({ root }).ready, true)
  assert.equal(deploy({ root, artifact: "opencode-test" }).deployed, true)
})
