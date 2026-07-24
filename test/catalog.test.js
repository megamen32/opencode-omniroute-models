import test from "node:test"
import assert from "node:assert/strict"
import { createCatalogFetcher, mergeCatalogModels, filterCatalogModels } from "../src/catalog.js"
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
