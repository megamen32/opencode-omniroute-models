import { existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"

const kitRoot = resolve(dirname(new URL(import.meta.url).pathname), "..")
const manifest = JSON.parse(readFileSync(join(kitRoot, "manifest.json"), "utf8"))

function fail(message) { throw new Error(message) }
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`)
  return (result.stdout || "").trim()
}
function option(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
function component(id) {
  const found = manifest.components.find((item) => item.id === id)
  if (!found) fail(`Unknown component ${id}`)
  return found
}
function assertPatchSeries(item) {
  if (item.kind !== "git-am-series") fail(`${item.id} is not a Git patch-series component`)
  for (const patch of item.patches) {
    const patchPath = join(kitRoot, patch)
    if (!existsSync(patchPath)) fail(`Manifest patch is missing: ${patch}`)
    const actual = createHash("sha256").update(readFileSync(patchPath)).digest("hex")
    if (item.patchHashes?.[patch] !== actual) fail(`Manifest patch hash mismatch: ${patch}`)
  }
}
function assertClean(source) {
  if (run("git", ["-C", source, "status", "--porcelain"]) !== "") fail(`Source worktree is dirty: ${source}`)
}
function assertBase(source, base) {
  run("git", ["-C", source, "cat-file", "-e", `${base}^{commit}`])
}
function applyIn(worktree, item) {
  for (const patch of item.patches) run("git", ["am", "--3way", join(kitRoot, patch)], worktree)
}

export function validateManifest(value = manifest) {
  if (value.schemaVersion !== 1 || !Array.isArray(value.components)) fail("Unsupported overlay manifest")
  for (const item of value.components) {
    if (!item.id || !item.kind || !item.product) fail("Every component needs id, kind, and product")
    if (item.kind === "git-am-series" && (!item.base || !Array.isArray(item.patches) || item.patches.length === 0)) {
      fail(`Patch-series component ${item.id} needs base and patches`)
    }
    if (item.kind === "git-am-series") {
      if (!item.patchHashes || item.patches.some((patch) => !/^[0-9a-f]{64}$/.test(item.patchHashes[patch] || ""))) {
        fail(`Patch-series component ${item.id} needs SHA-256 hashes for every patch`)
      }
      for (const patch of item.patches) {
        const patchPath = join(kitRoot, patch)
        if (existsSync(patchPath) && createHash("sha256").update(readFileSync(patchPath)).digest("hex") !== item.patchHashes[patch]) {
          fail(`Patch hash mismatch for ${item.id}: ${patch}`)
        }
      }
    }
  }
  return true
}

export function verifyPatchSeries({ id, source }) {
  validateManifest()
  const item = component(id)
  assertPatchSeries(item)
  assertClean(source)
  assertBase(source, item.base)
  const worktree = mkdtempSync(join(tmpdir(), `roomhacker-overlay-${id}-`))
  try {
    run("git", ["-C", source, "worktree", "add", "--detach", worktree, item.base])
    applyIn(worktree, item)
    return { component: id, base: item.base, verified: true }
  } finally {
    run("git", ["-C", source, "worktree", "remove", "--force", worktree])
    rmSync(worktree, { recursive: true, force: true })
  }
}

export function buildManagedArtifact({ id, source, destination }) {
  validateManifest()
  const item = component(id)
  assertPatchSeries(item)
  assertClean(source)
  assertBase(source, item.base)
  if (existsSync(destination)) fail(`Refusing to overwrite destination: ${destination}`)
  const parent = dirname(destination)
  const staging = mkdtempSync(join(parent, `.${basename(destination)}.staging-`))
  try {
    rmSync(staging, { recursive: true, force: true })
    run("git", ["clone", "--no-local", source, staging])
    run("git", ["checkout", "--detach", item.base], staging)
    applyIn(staging, item)
    writeFileSync(join(staging, ".roomhacker-overlay.json"), JSON.stringify({
      kit: manifest.kit, component: id, base: item.base, patches: item.patches,
    }, null, 2) + "\n")
    renameSync(staging, destination)
    return { component: id, destination, built: true }
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

function managedRoot(root) {
  const value = resolve(root)
  if (!existsSync(value)) fail(`Managed root does not exist: ${value}`)
  const marker = join(value, ".roomhacker-overlay-root")
  if (!existsSync(marker)) fail(`Missing managed-root marker: ${marker}`)
  return value
}

export function doctor({ root }) {
  validateManifest()
  const managed = managedRoot(root)
  const current = join(managed, "current")
  return { kit: manifest.kit, root: managed, current: existsSync(current) ? resolve(current) : null, ready: true }
}

function managedArtifact(root, artifact) {
  const managed = managedRoot(root)
  const candidate = resolve(managed, artifact)
  if (relative(managed, candidate).startsWith(`..${sep}`) || candidate === managed) fail("Artifact must be inside managed root")
  if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) fail(`Artifact directory does not exist: ${candidate}`)
  if (!existsSync(join(candidate, ".roomhacker-overlay.json"))) fail(`Not a managed artifact: ${candidate}`)
  return { managed, candidate }
}

export function deploy({ root, artifact }) {
  const { managed, candidate } = managedArtifact(root, artifact)
  const current = join(managed, "current")
  const next = join(managed, `.current-${process.pid}-${Date.now()}`)
  symlinkSync(candidate, next, "dir")
  renameSync(next, current)
  return { deployed: true, current, artifact: candidate }
}

export function rollback({ root, artifact }) { return deploy({ root, artifact }) }

function main(args) {
  const command = args[0]
  if (command === "plan") {
    validateManifest()
    console.log(JSON.stringify({ kit: manifest.kit, components: manifest.components.map(({ id, kind, product }) => ({ id, kind, product })) }, null, 2))
    return
  }
  if (command === "doctor") console.log(JSON.stringify(doctor({ root: option(args, "--root") || fail("--root is required") })))
  else if (command === "deploy" || command === "rollback") console.log(JSON.stringify((command === "deploy" ? deploy : rollback)({ root: option(args, "--root") || fail("--root is required"), artifact: option(args, "--artifact") || fail("--artifact is required") })))
  else if (command === "build") {
    const id = option(args, "--component")
    const source = option(args, "--source")
    if (!id || !source) fail("--component and --source are required")
    const destination = option(args, "--destination")
    if (!destination) fail("--destination is required for build")
    console.log(JSON.stringify(buildManagedArtifact({ id, source: resolve(source), destination: resolve(destination) })))
  } else if (command === "verify") {
    const id = option(args, "--component")
    const source = option(args, "--source")
    if (!id || !source) fail("--component and --source are required")
    const item = component(id)
    if (item.kind !== "git-am-series") fail(`${id} uses unsupported kind ${item.kind}; only git-am-series is executable by this CLI`)
    console.log(JSON.stringify(verifyPatchSeries({ id, source: resolve(source) })))
  } else fail("Use: plan | verify | build | doctor | deploy | rollback")
}

if (process.argv[1] === new URL(import.meta.url).pathname) main(process.argv.slice(2))
