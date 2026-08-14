import basePlugin from "opencode-omniroute-auth"
const OMNIROUTE_PROVIDER_ID = "omniroute"
import { readdir, readFile } from "fs/promises"
import { homedir } from "os"
import { join } from "path"
import {
  createCatalogFetcher,
  isForbiddenSelector,
  mergeCatalogModels,
  normalizeCatalogModel,
  resolveSelectorOptions,
  toOpenCodeModelMetadata,
} from "./src/catalog.js"
import {
  evaluateUsageWindowGuard,
  filterGuardedModels,
  resolveUsageWindowGuardOptions,
} from "./src/usageWindowGuard.js"

const EFFORT_KEYS = new Set(["low", "medium", "high", "xhigh"])

const PREFIX_ALIAS = {
  cx: "codex",
  cc: "claude",
  gh: "github",
  ollamacloud: "ollama-cloud",
  kr: "kiro",
  if: "qoder",
}

const CATALOG_TTL_MS = Number(process.env.OPENCODE_OMNIROUTE_MODEL_TTL_MS) || 300_000
let catalogFetcherKey = null
let catalogFetcher = null

function fetchLiveCatalog(baseURL, apiKey) {
  const key = `${baseURL}\u0000${apiKey || ""}`
  if (catalogFetcherKey !== key) {
    catalogFetcherKey = key
    catalogFetcher = createCatalogFetcher({ baseURL, apiKey, ttlMs: CATALOG_TTL_MS })
  }
  return catalogFetcher()
}

function mergeLiveCatalogModels(models, catalogModels, selectorOptions) {
  const normalized = catalogModels.map(toOpenCodeCatalogModel)
  return injectConfiguredComboModels(mergeCatalogModels(models, normalized, selectorOptions), selectorOptions)
}

function injectConfiguredComboModels(models, selectorOptions = {}) {
  const result = { ...models }
  for (const id of configuredComboModelIds) {
    if (!result[id] && !isForbiddenSelector(id, selectorOptions)) {
      result[id] = toOpenCodeCatalogModel({ id, name: id, owned_by: "combo" })
    }
  }
  return result
}

function toOpenCodeCatalogModel(model) {
  const normalized = normalizeCatalogModel(model)
  const metadata = toOpenCodeModelMetadata(normalized)
  const id = model.id
  const context = positiveNumber(
    normalized.context_length,
    normalized.contextWindow,
    normalized.max_input_tokens,
    normalized.limit?.context,
  )
  const output = positiveNumber(normalized.max_output_tokens, normalized.maxTokens, normalized.limit?.output)
  return {
    ...normalized,
    id,
    name: id,
    object: model.object || "model",
    owned_by: model.owned_by || "omniroute",
    permission: Array.isArray(model.permission) ? model.permission : [],
    root: model.root || id,
    parent: model.parent ?? null,
    context_length: context,
    max_input_tokens: positiveNumber(model.max_input_tokens, model.limit?.input, context),
    max_output_tokens: output,
    limit: metadata.limit,
    input_modalities: normalized.input_modalities,
    output_modalities: normalized.output_modalities,
    modalities: metadata.modalities,
    capabilities: {
      tool_calling: true,
      temperature: true,
      structured_output: true,
      ...(model.capabilities || {}),
    },
  }
}

let effortBasesCache = null
const configuredComboModelIds = new Set()

export default async (input, options) => {
  const base = await basePlugin(input, options)
  const pluginSelectorOptions = resolveSelectorOptions({}, options, {
    includeAuto: process.env.OPENCODE_OMNIROUTE_INCLUDE_AUTO,
    includeBest: process.env.OPENCODE_OMNIROUTE_INCLUDE_BEST,
  })
  const pluginUsageGuardOptions = resolveUsageWindowGuardOptions({}, options)

  return {
    ...base,
    config: async (config) => {
      await base.config?.(config)

      rememberConfiguredComboModels(config)

      const provider = config.provider?.[OMNIROUTE_PROVIDER_ID]
      if (provider) {
        provider.api = undefined
        if (provider.models) {
          const baseURL = getBaseURL(provider.options)
          const apiKey = await readAuthKey(OMNIROUTE_PROVIDER_ID)
          const catalogModels = await fetchLiveCatalog(baseURL, apiKey)
          const eb = await fetchEffortBases(baseURL, apiKey)
          const selectorOptions = resolveSelectorOptions(provider.options, pluginSelectorOptions)
          const guardEvaluation = synchronizeUsageGuard(provider.options, pluginUsageGuardOptions)
          provider.models = processModels(
            mergeLiveCatalogModels(provider.models, catalogModels, selectorOptions),
            eb,
            selectorOptions,
            guardEvaluation,
          )
        }
      }
    },
    provider: {
      ...base.provider,
      id: OMNIROUTE_PROVIDER_ID,
      models: async (providerCfg, ctx) => {
        const baseModels = await base.provider.models(providerCfg, ctx)
        const baseURL = getBaseURL(providerCfg?.options)
        const apiKey = ctx?.auth?.type === "api" && ctx.auth.key
          ? ctx.auth.key.trim()
          : await readAuthKey(OMNIROUTE_PROVIDER_ID)
        const catalogModels = await fetchLiveCatalog(baseURL, apiKey)
        const eb = await fetchEffortBases(baseURL, apiKey)
        const selectorOptions = resolveSelectorOptions(providerCfg?.options, pluginSelectorOptions)
        const guardEvaluation = synchronizeUsageGuard(providerCfg?.options, pluginUsageGuardOptions)
        return processModels(mergeLiveCatalogModels(baseModels, catalogModels, selectorOptions), eb, selectorOptions, guardEvaluation)
      },
    },
  }
}

function rememberConfiguredComboModels(config) {
  const remember = (value) => {
    if (typeof value !== "string") return
    const prefix = `${OMNIROUTE_PROVIDER_ID}/`
    if (!value.startsWith(prefix)) return
    const id = value.slice(prefix.length).trim()
    if (id.length > 0) configuredComboModelIds.add(id)
  }

  remember(config.model)
  remember(config.small_model)
  const agents = config.agent && typeof config.agent === "object" ? Object.values(config.agent) : []
  for (const agent of agents) {
    if (agent && typeof agent === "object") remember(agent.model)
  }
}

function processModels(models, effortBases, selectorOptions, guardEvaluation) {
  const entries = Object.entries(filterGuardedModels(models, guardEvaluation))
  const kept = filterModels(entries, selectorOptions)
  const result = {}
  for (const [id, model] of kept) {
    result[id] = enhanceModel(model, effortBases, id)
  }
  return result
}

function synchronizeUsageGuard(providerOptions, pluginOptions) {
  const guard = resolveUsageWindowGuardOptions(providerOptions, pluginOptions)
  if (!guard.enabled) return undefined
  return evaluateUsageWindowGuard(guard)
}

function filterModels(entries, selectorOptions) {
  return entries.filter(([id]) => !isForbiddenSelector(id, selectorOptions))
}

function enhanceModel(model, effortBases, selectedId) {
  const id = model.id
  const result = { ...model }

  result.name = selectedId

  if (!result.cost) {
    const input = Number(model.input_price)
    const output = Number(model.output_price)
    if (Number.isFinite(input) || Number.isFinite(output)) {
      result.cost = {
        input: Number.isFinite(input) ? input : 0,
        output: Number.isFinite(output) ? output : 0,
      }
    }
  }

  if (!model.capabilities?.reasoning && !model.reasoning) return result

  const hasRealEffort = effortBases && effortBases.has(id)
  const variants = {}

  if (hasRealEffort) {
    const upstreamVariants = model.variants || {}
    for (const key of ["low", "medium", "high", "xhigh"]) {
      if (key in upstreamVariants) {
        variants[key] = upstreamVariants[key]
      }
    }
  } else {
    variants.thinking = { disabled: false }
  }

  result.variants = variants
  result.interleaved = { field: "reasoning" }
  result.capabilities = {
    ...(model.capabilities || {}),
    interleaved: { field: "reasoning" },
  }

  return result
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return undefined
}

async function fetchEffortBases(baseURL, apiKey) {
  try {
    const resp = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    if (!resp.ok) return new Set()
    const data = await resp.json()
    const models = Array.isArray(data?.data) ? data.data : []
    const ids = new Set(models.map((m) => m.id))
    const bases = new Set()
    for (const m of models) {
      const match = m.id && m.id.match(/^(.+)-(xhigh|high|medium|low)$/)
      if (match && ids.has(match[1])) {
        bases.add(match[1])
        const parts = match[1].split("/")
        if (parts.length === 2 && PREFIX_ALIAS[parts[0]]) {
          bases.add(`${PREFIX_ALIAS[parts[0]]}/${parts[1]}`)
        }
      }
    }
    effortBasesCache = bases
    return bases
  } catch {
    return new Set()
  }
}

async function readAuthKey(providerID) {
  const home = process.env.HOME || homedir()
  const dataHome = process.env.XDG_DATA_HOME || join(home, ".local", "share")
  const authPaths = [join(dataHome, "opencode", "auth.json")]

  // claude-multimodel-nodejs keeps the shared OpenCode auth under a per-profile
  // Application Support directory on macOS rather than XDG_DATA_HOME.
  if (process.platform === "darwin") {
    const profilesRoot = join(home, "Library", "Application Support", "claude-multimodel-nodejs", "opencode", "profiles")
    try {
      const profiles = await readdir(profilesRoot)
      for (const profile of profiles) {
        authPaths.push(join(profilesRoot, profile, "data", "opencode", "auth.json"))
      }
    } catch {
      // The regular XDG path remains the only candidate when the app is absent.
    }
  }

  for (const authPath of authPaths) {
    try {
      const auth = JSON.parse(await readFile(authPath, "utf8"))?.[providerID]
      if (auth?.type === "api" && typeof auth.key === "string" && auth.key.trim()) {
        return auth.key.trim()
      }
    } catch {
      // Try the next known auth location without exposing credentials.
    }
  }
  return null
}

function getBaseURL(options) {
  const value = typeof options?.baseURL === "string" && options.baseURL.trim()
    ? options.baseURL.trim()
    : "http://localhost:20128/v1"
  return value.replace(/\/+$/, "")
}
