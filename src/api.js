// Read-only calls against the Puku inference API.

import { PUKU } from "./constants.js"

/**
 * Lists the models the Puku account can use. The catalog endpoint is public,
 * so a failing or slow call falls back to the known model IDs instead of
 * leaving the provider empty.
 */
export async function listModels() {
  try {
    const response = await fetch(`${PUKU.apiBase}/models`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const body = await response.json()
    const ids = Array.isArray(body?.data)
      ? body.data.map((model) => model?.id).filter((id) => typeof id === "string")
      : []
    if (!ids.length) throw new Error("empty model list")
    return ids.map(toModelInfo)
  } catch {
    return PUKU.fallbackModels.map(toModelInfo)
  }
}

/** Builds the OpenCode model definition for one Puku model ID. */
export function toModelInfo(id) {
  return {
    id,
    modelID: id,
    providerID: PUKU.providerID,
    name: PUKU.modelNames[id] ?? id,
    package: PUKU.package,
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: PUKU.contextLimit, output: PUKU.outputLimit },
  }
}
