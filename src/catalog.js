const FORBIDDEN_SELECTOR_SEGMENTS = new Set(["auto", "best"])
const MINIMAX_M3_ID = "minimax/MiniMax-M3"
const MINIMAX_M3_512K_ID = "minimax/MiniMax-M3:512k"
const MINIMAX_M3_512K_LIMIT = 512_000

/**
 * Resolve selector flags with the most local configuration taking precedence.
 *
 * @param {Record<string, unknown>} [providerOptions] provider-level options
 * @param {Record<string, unknown>} [pluginOptions] plugin tuple options
 * @param {Record<string, unknown>} [environment] environment-style options
 * @returns {{includeAuto: boolean, includeBest: boolean}} resolved flags
 */
export function resolveSelectorOptions(providerOptions = {}, pluginOptions = {}, environment = {}) {
  return {
    includeAuto: readBooleanOption(
      providerOptions.includeAuto,
      pluginOptions.includeAuto,
      environment.includeAuto,
    ),
    includeBest: readBooleanOption(
      providerOptions.includeBest,
      pluginOptions.includeBest,
      environment.includeBest,
    ),
  }
}

/**
 * Returns true for routing selectors that must not be exposed as selectable models.
 *
 * @param {string} id model identifier
 * @param {{includeAuto?: boolean, includeBest?: boolean}} [options] selector flags
 * @returns {boolean} whether the identifier is an automatic/best selector
 */
export function isForbiddenSelector(id, options = {}) {
  return id.split("/").some((segment) => {
    const normalized = segment.toLowerCase()
    if (normalized === "auto") return options.includeAuto !== true
    if (normalized === "best") return options.includeBest !== true
    return false
  })
}

/**
 * Normalize only metadata that OmniRoute can authoritatively provide.
 * Unknown limits and modalities remain unknown instead of receiving guesses.
 *
 * @param {Record<string, unknown>} model raw OmniRoute model entry
 * @returns {Record<string, unknown>} normalized model entry
 */
export function normalizeCatalogModel(model) {
  const inputModalities = model.input_modalities ?? model.modalities?.input
  const outputModalities = model.output_modalities ?? model.modalities?.output
  const context = positiveNumber(
    model.context_length,
    model.contextWindow,
    model.max_input_tokens,
    model.limit?.context,
  )
  return {
    ...model,
    context_length: context,
    max_input_tokens: positiveNumber(model.max_input_tokens, model.limit?.input, context),
    max_output_tokens: positiveNumber(model.max_output_tokens, model.maxTokens, model.limit?.output),
    input_modalities: normalizeModalities(inputModalities),
    output_modalities: normalizeModalities(outputModalities),
  }
}

/**
 * Project live catalog facts into the OpenCode provider-model schema.
 *
 * @param {Record<string, unknown>} model normalized or raw catalog model
 * @returns {{limit: Record<string, number>, modalities: {input: string[], output: string[]}}} metadata
 */
export function toOpenCodeModelMetadata(model) {
  const normalized = normalizeCatalogModel(model)
  const limit = {}
  const context = positiveNumber(normalized.context_length, normalized.contextWindow, normalized.limit?.context)
  const input = positiveNumber(normalized.max_input_tokens, normalized.limit?.input)
  const output = positiveNumber(normalized.max_output_tokens, normalized.maxTokens, normalized.limit?.output)
  if (context !== undefined) limit.context = context
  if (input !== undefined) limit.input = input
  if (output !== undefined) limit.output = output
  return {
    limit,
    modalities: {
      input: normalized.input_modalities,
      output: normalized.output_modalities,
    },
  }
}

/**
 * Keep every valid live model except the explicitly forbidden selectors.
 *
 * @param {unknown} models model entries returned by OmniRoute
 * @param {{includeAuto?: boolean, includeBest?: boolean}} [options] selector flags
 * @returns {Array<Record<string, unknown>>} safe catalog entries
 */
export function filterCatalogModels(models, options = {}) {
  if (!Array.isArray(models)) return []
  return models.filter((model) => {
    if (!model || typeof model !== "object" || typeof model.id !== "string") return false
    const id = model.id.trim()
    return id.length > 0 && !isForbiddenSelector(id, options)
  })
}

/**
 * Merge the live catalog into OpenCode's provider model map without a prefix allowlist.
 *
 * @param {Record<string, Record<string, unknown>>} baseModels models already known to OpenCode
 * @param {unknown} catalogModels models returned by OmniRoute
 * @param {{includeAuto?: boolean, includeBest?: boolean}} [options] selector flags
 * @returns {Record<string, Record<string, unknown>>} merged model map
 */
export function mergeCatalogModels(baseModels, catalogModels, options = {}) {
  const result = {}
  for (const [id, model] of Object.entries(baseModels || {})) {
    if (typeof id === "string" && !isForbiddenSelector(id, options)) result[id] = model
  }
  for (const model of filterCatalogModels(catalogModels, options)) {
    result[model.id] = model
  }
  preferFullProviderAliases(result)
  const minimaxM3 = result[MINIMAX_M3_ID]
  if (minimaxM3 && !result[MINIMAX_M3_512K_ID]) {
    result[MINIMAX_M3_512K_ID] = {
      ...minimaxM3,
      id: MINIMAX_M3_ID,
      name: MINIMAX_M3_512K_ID,
      context_length: MINIMAX_M3_512K_LIMIT,
      max_input_tokens: MINIMAX_M3_512K_LIMIT,
      limit: {
        ...(minimaxM3.limit || {}),
        context: MINIMAX_M3_512K_LIMIT,
        input: MINIMAX_M3_512K_LIMIT,
      },
    }
  }
  return result
}

/**
 * Remove the short `oc/` spelling when OmniRoute also exposes `opencode/`.
 *
 * @param {Record<string, Record<string, unknown>>} models merged model map
 * @returns {void}
 */
function preferFullProviderAliases(models) {
  for (const id of Object.keys(models)) {
    if (!id.startsWith("oc/")) continue
    const fullId = `opencode/${id.slice("oc/".length)}`
    if (models[fullId]) delete models[id]
  }
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

function normalizeModalities(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : []
}

function readBooleanOption(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value
    if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
  }
  return false
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return undefined
}
