import { createServer } from "node:http"

const TELEMETRY_PORT = 20129
const SESSION_HEADER = "x-omniroute-session-id"
const MODEL_HEADER = "x-omniroute-model"

const latestBySession = new Map()
let server = null
let originalFetch = null

export function readRouteTelemetry(headers, requestSessionID = undefined) {
  const normalized = new Headers(headers)
  const model = normalized.get(MODEL_HEADER)?.trim()
  const sessionID = (normalized.get(SESSION_HEADER) ?? requestSessionID)?.trim()
  if (!model || !sessionID) return null
  return { model, sessionID }
}

export function captureRouteTelemetry(responseHeaders, requestHeaders = undefined) {
  const requestSessionID = requestHeaders
    ? new Headers(requestHeaders).get(SESSION_HEADER)
    : undefined
  const telemetry = readRouteTelemetry(responseHeaders, requestSessionID)
  if (telemetry) latestBySession.set(telemetry.sessionID, { ...telemetry, updatedAt: Date.now() })
  return telemetry
}

export function wrapProviderFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") return fetchImpl
  return async (input, init) => {
    const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined)
    for (const [key, value] of new Headers(init?.headers)) requestHeaders.set(key, value)
    const response = await fetchImpl(input, init)
    captureRouteTelemetry(response.headers, requestHeaders)
    return response
  }
}

export function installRouteTelemetry() {
  if (originalFetch) return
  originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined)
    for (const [key, value] of new Headers(init?.headers)) requestHeaders.set(key, value)
    const response = await originalFetch(input, init)
    captureRouteTelemetry(response.headers, requestHeaders)
    return response
  }

  server = createServer((request, response) => {
    const headers = corsHeaders()
    for (const [key, value] of Object.entries(headers)) response.setHeader(key, value)
    if (request.method === "OPTIONS") {
      response.statusCode = 204
      response.end()
      return
    }
    if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/latest") {
      response.statusCode = 404
      response.end("Not found")
      return
    }
    const latest = [...latestBySession.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify(latest))
  })
  server.listen(TELEMETRY_PORT, "127.0.0.1")
}

export function telemetryHeaders(sessionID) {
  const value = typeof sessionID === "string" ? sessionID.trim() : ""
  return value ? { "X-OmniRoute-Session-ID": value } : {}
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "http://127.0.0.1:3020",
    "access-control-allow-methods": "GET,OPTIONS",
  }
}

export function disposeRouteTelemetry() {
  server?.close?.()
  server = null
  if (originalFetch) globalThis.fetch = originalFetch
  originalFetch = null
  latestBySession.clear()
}
