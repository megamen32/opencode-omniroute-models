const FORBIDDEN_SELECTOR_SEGMENTS = new Set(["auto", "best"])

/**
 * Returns true for routing selectors that must not be exposed as selectable models.
 *
 * @param {string} id model identifier
 * @returns {boolean} whether the identifier is an automatic/best selector
 */
export function isForbiddenSelector(id) {
  return id.split("/").some((segment) => FORBIDDEN_SELECTOR_SEGMENTS.has(segment.toLowerCase()))
}

/**
 * Keep every valid live model except the explicitly forbidden selectors.
 *
 * @param {unknown} models model entries returned by OmniRoute
 * @returns {Array<Record<string, unknown>>} safe catalog entries
 */
export function filterCatalogModels(models) {
  if (!Array.isArray(models)) return []
  return models.filter((model) => {
    if (!model || typeof model !== "object" || typeof model.id !== "string") return false
    const id = model.id.trim()
    return id.length > 0 && !isForbiddenSelector(id)
  })
}

/**
 * Merge the live catalog into OpenCode's provider model map without a prefix allowlist.
 *
 * @param {Record<string, Record<string, unknown>>} baseModels models already known to OpenCode
 * @param {unknown} catalogModels models returned by OmniRoute
 * @returns {Record<string, Record<string, unknown>>} merged model map
 */
export function mergeCatalogModels(baseModels, catalogModels) {
  const result = {}
  for (const [id, model] of Object.entries(baseModels || {})) {
    if (typeof id === "string" && !isForbiddenSelector(id)) result[id] = model
  }
  for (const model of filterCatalogModels(catalogModels)) {
    result[model.id] = model
  }
  return result
}

/**
 * Create a TTL-based fetcher for OmniRoute's OpenAI-compatible model endpoint.
 *
 * @param {object} options fetcher options
 * @param {string} options.baseURL OmniRoute base URL, normally ending in /v1
 * @param {string|null} options.apiKey optional bearer token
 * @param {number} [options.ttlMs=300000] cache lifetime
 * @param {typeof fetch} [options.fetchImpl=fetch] fetch implementation
 * @param {() => number} [options.now=Date.now] clock for deterministic tests
 * @returns {() => Promise<Array<Record<string, unknown>>>} catalog fetcher
 */
export function createCatalogFetcher({ baseURL, apiKey, ttlMs = 300_000, fetchImpl = fetch, now = Date.now }) {
  let cachedModels = null
  let cachedAt = -Infinity

  return async function fetchCatalog() {
    if (cachedModels && now() - cachedAt < ttlMs) return cachedModels

    try {
      const response = await fetchImpl(`${baseURL.replace(/\/+$/, "")}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      })
      if (!response.ok) return cachedModels || []
      const payload = await response.json()
      const models = filterCatalogModels(payload?.data)
      cachedModels = models
      cachedAt = now()
      return models
    } catch {
      return cachedModels || []
    }
  }
}
