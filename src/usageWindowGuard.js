const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

/**
 * Resolve the most-local usage guard configuration. The guard is disabled by
 * default; a policy only changes an account when the operator opts in.
 */
export function resolveUsageWindowGuardOptions(providerOptions = {}, pluginOptions = {}) {
  const raw = providerOptions?.usageWindowGuard ?? pluginOptions?.usageWindowGuard
  if (!raw || typeof raw !== "object") return { enabled: false, dryRun: true, policies: [] }

  return {
    enabled: raw.enabled === true,
    dryRun: raw.dryRun !== false,
    policies: Array.isArray(raw.policies) ? raw.policies.map(normalizePolicy).filter(Boolean) : [],
  }
}

/**
 * Calculate which configured provider connections must be paused at `now`.
 * Invalid scheduling data is deliberately fail-closed for its own connection.
 */
export function evaluateUsageWindowGuard(guard, now = new Date()) {
  if (!guard?.enabled) return { blockedConnectionIds: [], blockedModelPrefixes: [], reasons: new Map() }

  const blocked = new Map()
  for (const policy of guard.policies || []) {
    const reason = isPolicyBlocked(policy, now)
    if (!reason) continue
    blocked.set(policy.connectionId, { policy, reason })
  }

  const entries = [...blocked.entries()].sort(([a], [b]) => a.localeCompare(b))
  return {
    blockedConnectionIds: entries.map(([connectionId]) => connectionId),
    blockedModelPrefixes: [...new Set(entries.flatMap(([, value]) => value.policy.modelPrefixes))],
    reasons: new Map(entries.map(([connectionId, value]) => [connectionId, value.reason])),
  }
}

/** Remove only selectors explicitly covered by active guard policies. */
export function filterGuardedModels(models, evaluation) {
  const result = {}
  const prefixes = evaluation?.blockedModelPrefixes || []
  for (const [id, model] of Object.entries(models || {})) {
    if (!prefixes.some((prefix) => id.startsWith(prefix))) result[id] = model
  }
  return result
}

/**
 * Reconcile exact account IDs through OmniRoute's management API. We only
 * restore accounts this process disabled, avoiding accidental re-enabling of
 * accounts intentionally paused by an operator.
 */
export async function reconcileUsageWindowGuard(guard, evaluation, {
  baseURL,
  apiKey,
  fetchImpl = fetch,
  managedConnections = new Map(),
} = {}) {
  if (!guard?.enabled || guard.dryRun || !apiKey || !baseURL) return managedConnections

  const blocked = new Set(evaluation?.blockedConnectionIds || [])
  const configured = new Set((guard.policies || []).map((policy) => policy.connectionId))
  for (const connectionId of configured) {
    const shouldBeActive = !blocked.has(connectionId)
    const wasManaged = managedConnections.has(connectionId)
    const previousTarget = managedConnections.get(connectionId)
    if (!shouldBeActive && wasManaged) continue
    if (shouldBeActive && (!wasManaged || previousTarget?.restoreMode !== "always")) continue

    if (!shouldBeActive) {
      const current = await fetchImpl(providerConnectionURL(baseURL, connectionId), {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!current?.ok) continue
      const payload = await current.json?.()
      if (payload?.connection?.isActive !== true) continue
    }

    const response = await fetchImpl(providerConnectionURL(baseURL, connectionId), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive: shouldBeActive }),
    })
    if (!response?.ok) continue
    if (shouldBeActive) managedConnections.delete(connectionId)
    else managedConnections.set(connectionId, { restoreMode: policyForConnection(guard, connectionId)?.restoreMode })
  }
  return managedConnections
}

function normalizePolicy(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.connectionId !== "string" || !raw.connectionId.trim()) return null
  const modelPrefixes = Array.isArray(raw.modelPrefixes)
    ? raw.modelPrefixes.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
    : []
  return {
    connectionId: raw.connectionId.trim(),
    modelPrefixes,
    timezone: typeof raw.timezone === "string" && raw.timezone.trim() ? raw.timezone.trim() : null,
    restoreMode: raw.restoreMode === "always" ? "always" : "manual",
    windows: Array.isArray(raw.windows) ? raw.windows.map(normalizeWindow).filter(Boolean) : [],
  }
}

function policyForConnection(guard, connectionId) {
  return (guard.policies || []).find((policy) => policy.connectionId === connectionId)
}

function normalizeWindow(raw) {
  if (!raw || typeof raw !== "object") return null
  const start = parseMinutes(raw.start)
  const end = parseMinutes(raw.end)
  if (start === null || end === null || start === end) return null
  const days = Array.isArray(raw.days)
    ? raw.days.map((day) => typeof day === "string" ? day.trim().slice(0, 3).toLowerCase() : "").filter((day) => DAY_NAMES.includes(day))
    : DAY_NAMES
  return days.length > 0 ? { start, end, days } : null
}

function isPolicyBlocked(policy, now) {
  if (!policy.timezone || policy.windows.length === 0) return "invalid-schedule"
  const local = localTime(now, policy.timezone)
  if (!local) return "invalid-timezone"
  for (const window of policy.windows) {
    if (window.start < window.end && window.days.includes(local.day) && local.minutes >= window.start && local.minutes < window.end) {
      return "scheduled-window"
    }
    if (window.start > window.end) {
      if (window.days.includes(local.day) && local.minutes >= window.start) return "scheduled-window"
      const previousDay = DAY_NAMES[(DAY_NAMES.indexOf(local.day) + 6) % 7]
      if (window.days.includes(previousDay) && local.minutes < window.end) return "scheduled-window"
    }
  }
  return null
}

function localTime(now, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now)
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]))
    const day = values.weekday?.slice(0, 3).toLowerCase()
    const hour = Number(values.hour)
    const minute = Number(values.minute)
    return DAY_NAMES.includes(day) && Number.isInteger(hour) && Number.isInteger(minute)
      ? { day, minutes: hour * 60 + minute }
      : null
  } catch {
    return null
  }
}

function parseMinutes(value) {
  if (typeof value !== "string") return null
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value.trim())
  return match ? Number(match[0].slice(0, 2)) * 60 + Number(match[0].slice(3, 5)) : null
}

function providerConnectionURL(baseURL, connectionId) {
  const url = new URL(baseURL)
  url.pathname = `/api/providers/${encodeURIComponent(connectionId)}`
  url.search = ""
  return url.toString()
}
