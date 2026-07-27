import test from "node:test"
import assert from "node:assert/strict"
import {
  createCatalogFetcher,
  mergeCatalogModels,
  filterCatalogModels,
  normalizeCatalogModel,
  resolveSelectorOptions,
  toOpenCodeModelMetadata,
} from "../src/catalog.js"
import { createServer } from "node:http"

test("keeps every live OmniRoute model except auto and best selectors", () => {
  const models = filterCatalogModels([
    { id: "oc/deepseek-v4-flash" },
    { id: "terra/gpt-5.6" },
    { id: "vendor/private-model" },
    { id: "auto/best-coding" },
    { id: "best/reasoning" },
    { id: "" },
  ])

  assert.deepEqual(models.map((model) => model.id), [
    "oc/deepseek-v4-flash",
    "terra/gpt-5.6",
    "vendor/private-model",
  ])
})

test("can opt into auto and best selectors independently", () => {
  const models = [
    { id: "auto/best-coding" },
    { id: "best/reasoning" },
    { id: "vendor/model" },
  ]

  assert.deepEqual(filterCatalogModels(models, { includeAuto: true }).map((model) => model.id), [
    "auto/best-coding",
    "vendor/model",
  ])
  assert.deepEqual(filterCatalogModels(models, { includeBest: true }).map((model) => model.id), [
    "best/reasoning",
    "vendor/model",
  ])
  assert.deepEqual(filterCatalogModels(models, { includeAuto: true, includeBest: true }).map((model) => model.id), [
    "auto/best-coding",
    "best/reasoning",
    "vendor/model",
  ])
})

test("resolves selector flags from plugin, provider, and environment options", () => {
  assert.deepEqual(resolveSelectorOptions(
    { includeAuto: false },
    { includeAuto: true, includeBest: true },
    { includeAuto: true, includeBest: false },
  ), { includeAuto: false, includeBest: true })
})

test("merges the complete live catalog instead of applying a provider allowlist", () => {
  const models = mergeCatalogModels(
    { "oc/old": { id: "oc/old" }, "auto/best-coding": { id: "auto/best-coding" } },
    [
      { id: "oc/deepseek-v4-flash", name: "DeepSeek Flash" },
      { id: "mimo/v2.5", name: "MiMo" },
      { id: "auto/best-coding", name: "Best Coding" },
    ],
  )

  assert.deepEqual(Object.keys(models), ["oc/old", "oc/deepseek-v4-flash", "mimo/v2.5"])
  assert.equal(models["mimo/v2.5"].name, "MiMo")
})

test("adds a 512K constrained alias for the canonical MiniMax M3 model", () => {
  const models = mergeCatalogModels({}, [
    { id: "minimax/MiniMax-M3", name: "MiniMax M3", context_length: 1_000_000 },
  ])

  assert.equal(models["minimax/MiniMax-M3"].context_length, 1_000_000)
  assert.equal(models["minimax/MiniMax-M3:512k"].id, "minimax/MiniMax-M3")
  assert.equal(models["minimax/MiniMax-M3:512k"].name, "minimax/MiniMax-M3:512k")
  assert.equal(models["minimax/MiniMax-M3:512k"].context_length, 512_000)
  assert.equal(models["minimax/MiniMax-M3:512k"].max_input_tokens, 512_000)
  assert.equal(models["minimax/MiniMax-M3:512k"].limit.context, 512_000)
  assert.equal(models["minimax/MiniMax-M3:512k"].limit.input, 512_000)
})

test("prefers the full opencode provider prefix over duplicate oc aliases", () => {
  const models = mergeCatalogModels({}, [
    { id: "oc/deepseek-v4-flash", name: "Short DeepSeek" },
    { id: "opencode/deepseek-v4-flash", name: "Full DeepSeek" },
    { id: "oc/unique-model", name: "Only Short Entry" },
  ])

  assert.equal(models["oc/deepseek-v4-flash"], undefined)
  assert.equal(models["opencode/deepseek-v4-flash"].name, "Full DeepSeek")
  assert.equal(models["oc/unique-model"].name, "Only Short Entry")
})

test("preserves authoritative context and modality metadata without fabricating defaults", () => {
  const known = normalizeCatalogModel({
    id: "vendor/vision-model",
    context_length: 128_000,
    max_input_tokens: 120_000,
    max_output_tokens: 8_192,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  })

  assert.equal(known.context_length, 128_000)
  assert.equal(known.max_input_tokens, 120_000)
  assert.deepEqual(known.input_modalities, ["text", "image"])
  assert.deepEqual(known.output_modalities, ["text"])

  const unknown = normalizeCatalogModel({ id: "vendor/unknown-model" })
  assert.equal(unknown.context_length, undefined)
  assert.deepEqual(unknown.input_modalities, [])
  assert.deepEqual(unknown.output_modalities, [])
})

test("projects live metadata into OpenCode's limit and modality schema", () => {
  const metadata = toOpenCodeModelMetadata({
    id: "vendor/vision-model",
    context_length: 128_000,
    max_input_tokens: 120_000,
    max_output_tokens: 8_192,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  })

  assert.deepEqual(metadata.limit, { context: 128_000, input: 120_000, output: 8_192 })
  assert.deepEqual(metadata.modalities, { input: ["text", "image"], output: ["text"] })
})

test("refreshes the live catalog after the configured TTL", async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ data: [{ id: `oc/model-${requests}` }] }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()

  try {
    let now = 0
    const fetchCatalog = createCatalogFetcher({
      baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
      ttlMs: 100,
      now: () => now,
    })
    assert.deepEqual((await fetchCatalog()).map((model) => model.id), ["oc/model-1"])
    assert.deepEqual((await fetchCatalog()).map((model) => model.id), ["oc/model-1"])
    now = 101
    assert.deepEqual((await fetchCatalog()).map((model) => model.id), ["oc/model-2"])
    assert.equal(requests, 2)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
