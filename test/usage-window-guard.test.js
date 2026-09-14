import test from "node:test"
import assert from "node:assert/strict"
import {
  evaluateUsageWindowGuard,
  filterGuardedModels,
  reconcileUsageWindowGuard,
  resolveUsageWindowGuardOptions,
} from "../src/usageWindowGuard.js"

const mondayAt = (hour, minute = 0) => new Date(Date.UTC(2026, 6, 27, hour, minute))

test("blocks configured Z.ai and Qoder accounts during their local paid-overage windows", () => {
  const guard = resolveUsageWindowGuardOptions({}, {
    usageWindowGuard: {
      enabled: true,
      policies: [
        {
          id: "zai-high-usage",
          connectionId: "zai-connection",
          modelPrefixes: ["zai/"],
          timezone: "UTC",
          windows: [{ days: ["mon"], start: "09:00", end: "17:00" }],
        },
        {
          id: "qoder-high-usage",
          connectionId: "qoder-connection",
          modelPrefixes: ["qoder/"],
          timezone: "UTC",
          windows: [{ days: ["mon"], start: "09:00", end: "17:00" }],
        },
      ],
    },
  })

  const evaluation = evaluateUsageWindowGuard(guard, mondayAt(12))
  assert.deepEqual(evaluation.blockedConnectionIds, ["qoder-connection", "zai-connection"])
  assert.deepEqual(
    filterGuardedModels({
      "zai/GLM-5": { id: "zai/GLM-5" },
      "qoder/Qwen-3.8": { id: "qoder/Qwen-3.8" },
      "minimax/MiniMax-M3": { id: "minimax/MiniMax-M3" },
    }, evaluation),
    { "minimax/MiniMax-M3": { id: "minimax/MiniMax-M3" } },
  )
})

test("re-enables accounts after a window and handles overnight windows in the named timezone", () => {
  const guard = resolveUsageWindowGuardOptions({}, {
    usageWindowGuard: {
      enabled: true,
      dryRun: false,
      policies: [{
        connectionId: "qoder-connection",
        modelPrefixes: ["qoder/"],
        timezone: "UTC",
        windows: [{ days: ["mon"], start: "22:00", end: "02:00" }],
      }],
    },
  })

  assert.deepEqual(evaluateUsageWindowGuard(guard, mondayAt(23)).blockedConnectionIds, ["qoder-connection"])
  assert.deepEqual(evaluateUsageWindowGuard(guard, new Date(Date.UTC(2026, 6, 28, 1))).blockedConnectionIds, ["qoder-connection"])
  assert.deepEqual(evaluateUsageWindowGuard(guard, new Date(Date.UTC(2026, 6, 28, 3))).blockedConnectionIds, [])
})

test("fails closed for a covered account with an invalid timezone and makes no change in dry-run mode", async () => {
  const guard = resolveUsageWindowGuardOptions({}, {
    usageWindowGuard: {
      enabled: true,
      dryRun: true,
      policies: [{
        connectionId: "zai-connection",
        modelPrefixes: ["zai/"],
        timezone: "Not/A_Zone",
        windows: [{ start: "09:00", end: "17:00" }],
      }],
    },
  })
  const evaluation = evaluateUsageWindowGuard(guard, mondayAt(12))
  assert.deepEqual(evaluation.blockedConnectionIds, ["zai-connection"])

  const calls = []
  const managedConnections = new Map()
  await reconcileUsageWindowGuard(guard, evaluation, {
    baseURL: "http://127.0.0.1:20128/v1",
    apiKey: "test-key",
    fetchImpl: async (...args) => calls.push(args),
  })
  assert.deepEqual(calls, [])
  assert.deepEqual(filterGuardedModels({ "zai/GLM-5": { id: "zai/GLM-5" } }, evaluation), {})
})

test("reconciles only configured accounts through the OmniRoute provider API", async () => {
  const guard = resolveUsageWindowGuardOptions({}, {
    usageWindowGuard: {
      enabled: true,
      dryRun: false,
      policies: [{
        connectionId: "zai-connection",
        modelPrefixes: ["zai/"],
        restoreMode: "always",
        timezone: "UTC",
        windows: [{ days: ["mon"], start: "09:00", end: "17:00" }],
      }],
    },
  })
  const calls = []
  const managedConnections = new Map()
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return init?.method === "PUT"
      ? { ok: true }
      : { ok: true, json: async () => ({ connection: { isActive: true } }) }
  }

  await reconcileUsageWindowGuard(guard, evaluateUsageWindowGuard(guard, mondayAt(12)), {
    baseURL: "http://127.0.0.1:20128/v1",
    apiKey: "test-key",
    fetchImpl,
    managedConnections,
  })
  await reconcileUsageWindowGuard(guard, evaluateUsageWindowGuard(guard, mondayAt(18)), {
    baseURL: "http://127.0.0.1:20128/v1",
    apiKey: "test-key",
    fetchImpl,
    managedConnections,
  })

  assert.deepEqual(calls.map(({ url, init }) => ({
    url,
    method: init?.method || "GET",
    authorization: init.headers.Authorization,
    body: init.body,
  })), [
    {
      url: "http://127.0.0.1:20128/api/providers/zai-connection",
      method: "GET",
      authorization: "Bearer test-key",
      body: undefined,
    },
    {
      url: "http://127.0.0.1:20128/api/providers/zai-connection",
      method: "PUT",
      authorization: "Bearer test-key",
      body: JSON.stringify({ isActive: false }),
    },
    {
      url: "http://127.0.0.1:20128/api/providers/zai-connection",
      method: "PUT",
      authorization: "Bearer test-key",
      body: JSON.stringify({ isActive: true }),
    },
  ])
})

test("safe default keeps a guard-paused account disabled after its window", async () => {
  const guard = resolveUsageWindowGuardOptions({}, {
    usageWindowGuard: {
      enabled: true,
      dryRun: false,
      policies: [{
        connectionId: "zai-connection",
        modelPrefixes: ["zai/"],
        timezone: "UTC",
        windows: [{ days: ["mon"], start: "09:00", end: "17:00" }],
      }],
    },
  })
  const calls = []
  const managedConnections = new Map()
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return init?.method === "PUT"
      ? { ok: true }
      : { ok: true, json: async () => ({ connection: { isActive: true } }) }
  }
  await reconcileUsageWindowGuard(guard, evaluateUsageWindowGuard(guard, mondayAt(12)), {
    baseURL: "http://127.0.0.1:20128/v1", apiKey: "test-key", fetchImpl, managedConnections,
  })
  await reconcileUsageWindowGuard(guard, evaluateUsageWindowGuard(guard, mondayAt(18)), {
    baseURL: "http://127.0.0.1:20128/v1", apiKey: "test-key", fetchImpl, managedConnections,
  })
  assert.equal(calls.filter((call) => call.init?.method === "PUT").length, 1)
  assert.equal(managedConnections.get("zai-connection")?.restoreMode, "manual")
})

test("missing controller credentials write nothing while the configured selector stays excluded", async () => {
  const guard = resolveUsageWindowGuardOptions({}, {
    usageWindowGuard: {
      enabled: true,
      dryRun: false,
      policies: [{ connectionId: "zai-connection", modelPrefixes: ["zai/"], timezone: "UTC", windows: [{ start: "09:00", end: "17:00" }] }],
    },
  })
  const evaluation = evaluateUsageWindowGuard(guard, mondayAt(12))
  const calls = []
  await reconcileUsageWindowGuard(guard, evaluation, {
    baseURL: "http://127.0.0.1:20128/v1",
    fetchImpl: async (...args) => calls.push(args),
  })
  assert.deepEqual(calls, [])
  assert.deepEqual(filterGuardedModels({ "zai/GLM-5": { id: "zai/GLM-5" } }, evaluation), {})
})

test("does not re-enable an account that was already inactive before the guard window", async () => {
  const guard = resolveUsageWindowGuardOptions({}, {
    usageWindowGuard: {
      enabled: true,
      dryRun: false,
      policies: [{
        connectionId: "manual-pause",
        modelPrefixes: ["zai/"],
        timezone: "UTC",
        windows: [{ days: ["mon"], start: "09:00", end: "17:00" }],
      }],
    },
  })
  const calls = []
  const managedConnections = new Map()
  await reconcileUsageWindowGuard(guard, evaluateUsageWindowGuard(guard, mondayAt(12)), {
    baseURL: "http://127.0.0.1:20128/v1",
    apiKey: "test-key",
    managedConnections,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return { ok: true, json: async () => ({ connection: { isActive: false } }) }
    },
  })
  await reconcileUsageWindowGuard(guard, evaluateUsageWindowGuard(guard, mondayAt(18)), {
    baseURL: "http://127.0.0.1:20128/v1",
    apiKey: "test-key",
    managedConnections,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return { ok: true }
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init?.method, undefined)
})
