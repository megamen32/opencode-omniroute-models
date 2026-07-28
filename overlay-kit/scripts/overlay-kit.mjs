import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
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
    if (!existsSync(join(kitRoot, patch))) fail(`Manifest patch is missing: ${patch}`)
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
  run("git", ["clone", "--no-local", source, destination])
  try {
    run("git", ["checkout", "--detach", item.base], destination)
    applyIn(destination, item)
    writeFileSync(join(destination, ".roomhacker-overlay.json"), JSON.stringify({
      kit: manifest.kit, component: id, base: item.base, patches: item.patches,
    }, null, 2) + "\n")
    return { component: id, destination, built: true }
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    throw error
  }
}

function main(args) {
  const command = args[0]
  if (command === "plan") {
    validateManifest()
    console.log(JSON.stringify({ kit: manifest.kit, components: manifest.components.map(({ id, kind, product }) => ({ id, kind, product })) }, null, 2))
    return
  }
  const id = option(args, "--component")
  const source = option(args, "--source")
  if (!id || !source) fail("--component and --source are required")
  if (command === "verify") console.log(JSON.stringify(verifyPatchSeries({ id, source: resolve(source) })))
  else if (command === "build") {
    const destination = option(args, "--destination")
    if (!destination) fail("--destination is required for build")
    console.log(JSON.stringify(buildManagedArtifact({ id, source: resolve(source), destination: resolve(destination) })))
  } else fail("Use: plan | verify --component ID --source DIR | build --component ID --source DIR --destination DIR")
}

if (process.argv[1] === new URL(import.meta.url).pathname) main(process.argv.slice(2))
