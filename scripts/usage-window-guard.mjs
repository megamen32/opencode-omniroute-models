#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "fs/promises"
import { homedir } from "os"
import { dirname, join } from "path"
import {
  evaluateUsageWindowGuard,
  reconcileUsageWindowGuard,
  resolveUsageWindowGuardOptions,
} from "../src/usageWindowGuard.js"

const configPath = process.env.OMNIROUTE_USAGE_GUARD_CONFIG || join(homedir(), ".config", "omniroute", "usage-window-guard.json")
const statePath = process.env.OMNIROUTE_USAGE_GUARD_STATE || join(homedir(), ".local", "state", "omniroute", "usage-window-guard.json")

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"))
  const guard = resolveUsageWindowGuardOptions({}, { usageWindowGuard: config.usageWindowGuard || config })
  if (!guard.enabled) {
    console.log("OmniRoute usage guard is disabled; no account state changed.")
    return
  }

  const evaluation = evaluateUsageWindowGuard(guard)
  if (guard.dryRun) {
    console.log(`OmniRoute usage guard dry run: ${evaluation.blockedConnectionIds.length} configured account(s) would pause.`)
    return
  }

  const apiKey = process.env.OMNIROUTE_USAGE_GUARD_API_KEY
  if (!apiKey) throw new Error("OMNIROUTE_USAGE_GUARD_API_KEY is required when dryRun is false")
  const baseURL = typeof config.baseURL === "string" ? config.baseURL : "http://127.0.0.1:20128/v1"
  const managedConnections = await readManagedConnections(statePath)
  await reconcileUsageWindowGuard(guard, evaluation, { baseURL, apiKey, managedConnections })
  await writeManagedConnections(statePath, managedConnections)
  console.log(`OmniRoute usage guard reconciled ${evaluation.blockedConnectionIds.length} configured paused account(s).`)
}

async function readManagedConnections(path) {
  try {
    const data = JSON.parse(await readFile(path, "utf8"))
    return new Map(Array.isArray(data?.managedConnections) ? data.managedConnections : [])
  } catch (error) {
    if (error?.code === "ENOENT") return new Map()
    throw error
  }
}

async function writeManagedConnections(path, managedConnections) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, JSON.stringify({ managedConnections: [...managedConnections.entries()] }) + "\n", { mode: 0o600 })
  await rename(temporary, path)
}

main().catch((error) => {
  console.error(`OmniRoute usage guard: ${error.message}`)
  process.exitCode = 1
})
