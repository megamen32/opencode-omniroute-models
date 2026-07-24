import basePlugin from "opencode-omniroute-auth"
const OMNIROUTE_PROVIDER_ID = "omniroute"
import { readdir, readFile } from "fs/promises"
import { homedir } from "os"
import { join } from "path"

const EFFORT_KEYS = new Set(["low", "medium", "high", "xhigh"])

const PREFIX_ALIAS = {
  cx: "codex",
  cc: "claude",
  gh: "github",
  ollamacloud: "ollama-cloud",
  kr: "kiro",
  if: "qoder",
}

const KEEP_PREFIXES = new Set([
  "codex",
  "claude",
  "ghm",
  "tllm",
  "glm",
  "ddgw",
  "oc",
  "ds",
  "mcode",
  "pepper",
  "veo-free",
  "opencode",
  "opencode-go",
])

/**
 * Auto-routing catalog (16 templates) — virtual combos that the omniroute
 * server resolves dynamically from connected providers. The server does NOT
 * list these in /v1/models, so we inject synthetic entries here so opencode
 * users can pick any of them as a model.
 *
 * Source of truth: apps/omniroute/src/domain/assessment/types.ts::AUTO_COMBO_TEMPLATES
 */
const AUTO_TEMPLATES = [
  { id: "auto/best-coding",        name: "Best Coding",      reasoning: true,  vision: false },
  { id: "auto/best-reasoning",     name: "Best Reasoning",   reasoning: true,  vision: false },
  { id: "auto/best-fast",          name: "Best Fast",        reasoning: false, vision: false },
  { id: "auto/best-vision",        name: "Best Vision",      reasoning: false, vision: true  },
  { id: "auto/best-chat",          name: "Best Chat",        reasoning: false, vision: false },
  { id: "auto/best-coding-fast",   name: "Best Coding Fast", reasoning: false, vision: false },
  { id: "auto/pro-coding",         name: "Pro Coding",       reasoning: true,  vision: false },
  { id: "auto/pro-reasoning",      name: "Pro Reasoning",    reasoning: true,  vision: false },
  { id: "auto/pro-vision",         name: "Pro Vision",       reasoning: false, vision: true  },
  { id: "auto/pro-chat",           name: "Pro Chat",         reasoning: false, vision: false },
  { id: "auto/pro-fast",           name: "Pro Fast",         reasoning: false, vision: false },
  { id: "auto/coding",             name: "Coding",           reasoning: true,  vision: false },
  { id: "auto/fast",               name: "Fast",             reasoning: false, vision: false },
  { id: "auto/chat",               name: "Chat",             reasoning: false, vision: false },
  { id: "auto/claude-opus",        name: "Claude Opus",      reasoning: true,  vision: false },
  { id: "auto/claude-sonnet",      name: "Claude Sonnet",    reasoning: true,  vision: false },
]

function buildAutoModel(template) {
  const capabilities = {
    tool_calling: true,
    temperature: true,
    structured_output: true,
    attachment: false,
  }
  if (template.reasoning) {
    capabilities.reasoning = true
    capabilities.thinking = true
  }
  if (template.vision) {
    capabilities.vision = true
  }
  return {
    id: template.id,
    name: template.name,
    object: "model",
    owned_by: "combo",
    permission: [],
    root: template.id,
    parent: null,
    context_length: 200000,
    max_input_tokens: 200000,
    max_output_tokens: 32000,
    input_modalities: template.vision ? ["text", "image"] : ["text"],
    output_modalities: ["text"],
    capabilities,
  }
}

function injectAutoModels(models) {
  return Object.fromEntries(Object.entries(models).filter(([id]) => !id.startsWith("auto/")))
}

function injectCatalogComboModels(models, catalogModels) {
  const result = { ...models }
  for (const model of catalogModels) {
    if (!model || typeof model.id !== "string" || model.id.length === 0) continue
    if (model.owned_by !== "combo") continue
    if (result[model.id]) continue
    result[model.id] = toOpenCodeCatalogModel(model)
  }
  return injectConfiguredComboModels(result)
}

function injectConfiguredComboModels(models) {
  const result = { ...models }
  for (const id of configuredComboModelIds) {
    if (!result[id]) {
      result[id] = toOpenCodeCatalogModel({ id, name: id, owned_by: "combo" })
    }
  }
  return result
}

function toOpenCodeCatalogModel(model) {
  const id = model.id
  const context = positiveNumber(
    model.context_length,
    model.contextWindow,
    model.max_input_tokens,
    model.limit?.context,
    200000
  )
  const output = positiveNumber(model.max_output_tokens, model.maxTokens, model.limit?.output, 32000)
  return {
    ...model,
    id,
    name: model.name || id,
    object: model.object || "model",
    owned_by: "combo",
    permission: Array.isArray(model.permission) ? model.permission : [],
    root: model.root || id,
    parent: model.parent ?? null,
    context_length: context,
    max_input_tokens: positiveNumber(model.max_input_tokens, model.limit?.input, context),
    max_output_tokens: output,
    input_modalities: Array.isArray(model.input_modalities) ? model.input_modalities : ["text"],
    output_modalities: Array.isArray(model.output_modalities) ? model.output_modalities : ["text"],
    capabilities: {
      tool_calling: true,
      temperature: true,
      structured_output: true,
      ...(model.capabilities || {}),
    },
  }
}

let effortBasesCache = null
let catalogModelsCache = null
const configuredComboModelIds = new Set()

export default async (input, options) => {
  const base = await basePlugin(input, options)

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
          const catalogModels = await fetchCatalogModels(baseURL, apiKey)
          const eb = await fetchEffortBases(baseURL, apiKey)
          provider.models = processModels(
            injectCatalogComboModels(injectAutoModels(provider.models), catalogModels),
            eb
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
        const catalogModels = await fetchCatalogModels(baseURL, apiKey)
        const eb = await fetchEffortBases(baseURL, apiKey)
        return processModels(injectCatalogComboModels(injectAutoModels(baseModels), catalogModels), eb)
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

function processModels(models, effortBases) {
  const entries = Object.entries(models)
  const kept = filterModels(entries)
  const result = {}
  for (const [id, model] of kept) {
    result[id] = enhanceModel(model, effortBases)
  }
  return result
}

function filterModels(entries) {
  return entries.filter(([id, model]) => {
    if (id.startsWith("auto/")) return false
    if (model?.owned_by === "combo") return true
    if (!id.includes("/")) return true

    const prefix = id.split("/")[0]

    if (KEEP_PREFIXES.has(prefix)) return true

    if (prefix === "openrouter") {
      return id.includes(":free")
    }

    return false
  })
}

function enhanceModel(model, effortBases) {
  const id = model.id
  const result = { ...model }

  result.name = prefixName(id, model.name || id)

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

function prefixName(id, name) {
  if (id.includes("/")) {
    const prefix = id.split("/")[0]
    if (!name.toLowerCase().startsWith(prefix.toLowerCase())) {
      return `${prefix} ${name}`
    }
  } else {
    if (!name.toLowerCase().startsWith("combo")) {
      return `combo ${name}`
    }
  }
  return name
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return undefined
}

async function fetchCatalogModels(baseURL, apiKey) {
  if (catalogModelsCache) return catalogModelsCache
  try {
    const resp = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    if (!resp.ok) return []
    const data = await resp.json()
    const models = Array.isArray(data?.data)
      ? data.data.filter((model) => model && typeof model.id === "string")
      : []
    catalogModelsCache = models
    return models
  } catch {
    return []
  }
}

async function fetchEffortBases(baseURL, apiKey) {
  if (effortBasesCache) return effortBasesCache
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
