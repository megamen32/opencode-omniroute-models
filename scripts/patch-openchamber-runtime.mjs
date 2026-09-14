import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

const DISPLAY_HELPER = /(const )?Q6=\(t,e,n=\{\}\)=>\{const s=Vi\(t\?\.name\);if\(s\)return ef\(s,n\.maxLength\);const o=Vi\(t\?\.id\)\|\|Vi\(e\);return o\?ef\(gb\(o\),n\.maxLength\):n\.fallbackLabel\?\?""\}/
const EXACT_DISPLAY_HELPER = 'const Q6=(t,e,n={})=>{const o=Vi(t?.id)||Vi(e);return o?ef(o,n.maxLength):n.fallbackLabel??""}'

/** Replace OpenChamber's humanizing model formatter with exact ID display. */
export function replaceExactModelDisplay(source) {
  if (source.includes(EXACT_DISPLAY_HELPER)) return source
  if (!DISPLAY_HELPER.test(source)) {
    throw new Error("OpenChamber model display helper was not found; refusing an unscoped runtime patch")
  }
  return source.replace(DISPLAY_HELPER, () => EXACT_DISPLAY_HELPER)
}

function findRuntimeAsset(assetDirectory) {
  const candidates = readdirSync(assetDirectory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(assetDirectory, name))
    .filter((path) => {
      const source = readFileSync(path, "utf8")
      return DISPLAY_HELPER.test(source) || source.includes(EXACT_DISPLAY_HELPER)
    })
  if (candidates.length !== 1) {
    throw new Error(`Expected one OpenChamber runtime asset, found ${candidates.length}`)
  }
  return candidates[0]
}

export function patchRuntime({ assetDirectory, backupDirectory }) {
  const asset = findRuntimeAsset(assetDirectory)
  const source = readFileSync(asset, "utf8")
  const patched = replaceExactModelDisplay(source)
  if (patched === source) return { asset, changed: false }

  mkdirSync(backupDirectory, { recursive: true })
  const backup = join(backupDirectory, `${basename(asset)}.bak`)
  if (!existsSync(backup)) copyFileSync(asset, backup)
  writeFileSync(asset, patched)
  return { asset, backup, changed: true }
}

if (process.argv.includes("--apply")) {
  const packageRoot = process.env.OPENCHAMBER_PACKAGE_ROOT ?? "/home/roomhacker/.npm-global/lib/node_modules/@openchamber/web"
  const result = patchRuntime({
    assetDirectory: resolve(packageRoot, "dist/assets"),
    backupDirectory: process.env.OPENCHAMBER_PATCH_BACKUP ?? join(packageRoot, ".codex-runtime-backups"),
  })
  console.log(JSON.stringify(result))
}
