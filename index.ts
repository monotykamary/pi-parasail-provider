/**
 * Parasail Provider Extension
 *
 * Registers Parasail (api.parasail.io) as a custom provider.
 * Base URL: https://api.parasail.io/v1 (OpenAI-compatible)
 *
 * Parasail's API is fully OpenAI-compatible and hosts a wide range of
 * open-source models including DeepSeek, Qwen, GLM, Kimi, Llama, Gemma,
 * Mistral, and more.
 *
 * Model resolution strategy: Stale-While-Revalidate
 *   1. Serve stale immediately: disk cache → embedded models.json (zero-latency)
 *   2. Revalidate in background:
 *      a. Live API /v1/models → merge with embedded → enrich with pricing
 *      b. Public pricing endpoint → apply input/output/cache costs + context windows
 *   3. patch.json is always applied on top of whichever source won
 *
 * Usage:
 *   # Option 1: Store in auth.json (recommended)
 *   # Add to ~/.pi/agent/auth.json:
 *   #   "parasail": { "type": "api_key", "key": "your-api-key" }
 *
 *   # Option 2: Set as environment variable
 *   export PARASAIL_API_KEY=your-api-key
 *
 *   # Run pi with the extension
 *   pi -e /path/to/pi-parasail-provider
 *
 * Then use /model to select from available models
 */

import type { ExtensionAPI, Model, Api, ModelCompat, ModelRegistry } from "@mariozechner/pi-coding-agent";
import modelsData from "./models.json" with { type: "json" };
import patchData from "./patch.json" with { type: "json" };
import fs from "fs";
import os from "os";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  compat?: ModelCompat;
}

interface PatchEntry {
  name?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  compat?: Record<string, unknown>;
}

type PatchData = Record<string, PatchEntry>;

// ─── Patch Application ────────────────────────────────────────────────────────

function applyPatch(models: JsonModel[], patch: PatchData): JsonModel[] {
  return models.map((model) => {
    const overrides = patch[model.id];
    if (!overrides) return model;

    const merged = { ...model };
    if (overrides.compat && merged.compat) {
      merged.compat = { ...merged.compat, ...overrides.compat };
      delete overrides.compat;
    }
    if (overrides.compat) {
      merged.compat = { ...(merged.compat || {}), ...overrides.compat };
      delete overrides.compat;
    }
    if (overrides.cost) {
      merged.cost = { ...merged.cost, ...overrides.cost };
      delete overrides.cost;
    }
    Object.assign(merged, overrides);

    if (!merged.reasoning && merged.compat?.thinkingFormat) {
      delete merged.compat.thinkingFormat;
    }
    if (merged.compat && Object.keys(merged.compat).length === 0) {
      delete merged.compat;
    }

    return merged;
  });
}

// ─── Model Transformation ─────────────────────────────────────────────────────

function transformModel(model: JsonModel): Model<Api> {
  const cost = model.cost ?? {};
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: model.input,
    cost: {
      input: cost.input ?? 0,
      output: cost.output ?? 0,
      cacheRead: cost.cacheRead ?? 0,
      cacheWrite: cost.cacheWrite ?? 0,
    },
    contextWindow: model.contextWindow ?? 0,
    maxTokens: model.maxTokens ?? 0,
    api: "openai-completions",
    provider: "parasail",
    compat: model.compat,
  } as Model<Api>;
}

// ─── Stale-While-Revalidate Model Sync ────────────────────────────────────────

const PROVIDER_ID = "parasail";
const BASE_URL = "https://api.parasail.io/v1";
const MODELS_URL = `${BASE_URL}/models`;
const PRICING_URL = "https://www.saas.parasail.io/api/v1/prices/serverlessEndpoints";
const CACHE_DIR = path.join(os.homedir(), ".pi", "agent", "cache");
const CACHE_PATH = path.join(CACHE_DIR, `${PROVIDER_ID}-models.json`);
const LIVE_FETCH_TIMEOUT_MS = 8000;

// Non-LLM model prefixes to skip (embedding, TTS, UI agent models)
const SKIP_PREFIXES = ["parasail-bge-", "parasail-resemble-", "parasail-ui-tars-"];

/** Transform a model from the Parasail /v1/models API. API returns minimal data (id only). */
function transformApiModel(apiModel: any): JsonModel | null {
  const id = apiModel.id;

  // Skip non-LLM models
  if (SKIP_PREFIXES.some(prefix => id.startsWith(prefix))) return null;

  // Prefer parasail- prefixed IDs (cleaner aliases)
  // Skip original IDs that have parasail- equivalents
  if (!id.startsWith("parasail-")) return null;

  return {
    id,
    name: generateDisplayName(id),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 16384,
  };
}

function generateDisplayName(id: string): string {
  // Strip parasail- prefix and prettify
  const raw = id.replace(/^parasail-/, "");
  return raw
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

interface PricingEntry {
  externalAlias: string;
  contextLength: number;
  inputCost: number | null;
  outputCost: number | null;
  cachedCost: number | null;
  tags: string[];
}

/** Fetch pricing data from the public Parasail SaaS pricing endpoint (no auth required). */
async function fetchPricingData(signal?: AbortSignal): Promise<Map<string, PricingEntry> | null> {
  try {
    const response = await fetch(PRICING_URL, {
      signal: signal ? AbortSignal.any([AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS), signal]) : AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data)) return null;
    const map = new Map<string, PricingEntry>();
    for (const entry of data) {
      const alias = entry.externalAlias;
      if (!alias || !alias.startsWith("parasail-")) continue;
      map.set(alias, {
        externalAlias: alias,
        contextLength: entry.contextLength || 0,
        inputCost: entry.inputCost ?? 0,
        outputCost: entry.outputCost ?? 0,
        cachedCost: entry.cachedCost ?? 0,
        tags: entry.tags || [],
      });
    }
    return map;
  } catch {
    return null;
  }
}

/** Enrich models with live pricing data from the public endpoint. */
function applyPricing(models: JsonModel[], pricing: Map<string, PricingEntry>): JsonModel[] {
  return models.map((model) => {
    const entry = pricing.get(model.id);
    if (!entry) return model;
    const updated = { ...model };
    updated.cost = {
      ...updated.cost,
      input: entry.inputCost ?? updated.cost.input,
      output: entry.outputCost ?? updated.cost.output,
      cacheRead: entry.cachedCost ?? updated.cost.cacheRead,
    };
    // Update context window from pricing data (authoritative)
    if (entry.contextLength) {
      updated.contextWindow = entry.contextLength;
    }
    // Update vision from tags
    if (entry.tags.includes("multimodal") && !updated.input.includes("image")) {
      updated.input = [...updated.input, "image"];
    }
    return updated;
  });
}

async function fetchLiveModels(apiKey: string, signal?: AbortSignal): Promise<JsonModel[] | null> {
  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal ? AbortSignal.any([AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS), signal]) : AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const apiModels = Array.isArray(data) ? data : (data.data || []);
    if (!Array.isArray(apiModels) || apiModels.length === 0) return null;
    return apiModels.map(transformApiModel).filter((m): m is JsonModel => m !== null);
  } catch {
    return null;
  }
}

function loadCachedModels(): JsonModel[] | null {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function cacheModels(models: JsonModel[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(models, null, 2) + "\n");
  } catch {
    // Cache write failure is non-fatal
  }
}

function mergeWithEmbedded(liveModels: JsonModel[], embeddedModels: JsonModel[]): JsonModel[] {
  const embeddedIds = new Set(embeddedModels.map(m => m.id));
  const result = [...embeddedModels];
  for (const model of liveModels) {
    if (!embeddedIds.has(model.id)) {
      result.push(model);
    }
  }
  return result;
}

function loadStaleModels(embeddedModels: JsonModel[]): JsonModel[] {
  const cached = loadCachedModels();
  if (cached && cached.length > 0) return cached;
  return embeddedModels;
}

async function revalidateModels(apiKey: string | undefined, embeddedModels: JsonModel[], signal?: AbortSignal): Promise<JsonModel[] | null> {
  // Fetch both models list and pricing in parallel
  const [liveModels, pricing] = await Promise.all([
    apiKey ? fetchLiveModels(apiKey, signal) : Promise.resolve(null),
    fetchPricingData(signal),
  ]);

  // Use embedded as base if live fetch failed
  const base = liveModels && liveModels.length > 0
    ? mergeWithEmbedded(liveModels, embeddedModels)
    : embeddedModels;

  // Always apply live pricing if available (public endpoint, no auth needed)
  const enriched = pricing ? applyPricing(base, pricing) : base;

  cacheModels(enriched);
  return enriched;
}

// ─── API Key Resolution (via ModelRegistry) ────────────────────────────────────

let cachedApiKey: string | undefined;
let revalidateAbort: AbortController | null = null;

async function resolveApiKey(modelRegistry: ModelRegistry): Promise<void> {
  cachedApiKey = await modelRegistry.getApiKeyForProvider("parasail") ?? undefined;
}

// ─── Extension Entry Point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // SWR: Serve stale immediately (cache → embedded) — zero-latency registration
  const embeddedModels = modelsData as JsonModel[];
  const staleBase = loadStaleModels(embeddedModels);
  const staleModels = applyPatch(staleBase, patchData as PatchData).map(transformModel);

  pi.registerProvider("parasail", {
    baseUrl: BASE_URL,
    apiKey: "PARASAIL_API_KEY",
    api: "openai-completions",
    models: staleModels,
  });

  // Revalidate in background: fetch live models + pricing → merge → cache → hot-swap
  // Pricing endpoint is public (no auth needed), models endpoint requires API key
  pi.on("session_start", async (_event, ctx) => {
    revalidateAbort?.abort();
    revalidateAbort = new AbortController();
    const signal = revalidateAbort.signal;
    await resolveApiKey(ctx.modelRegistry);
    revalidateModels(cachedApiKey, embeddedModels, signal).then((freshBase) => {
      if (freshBase && !signal.aborted) {
        pi.registerProvider("parasail", {
          baseUrl: BASE_URL,
          apiKey: "PARASAIL_API_KEY",
          api: "openai-completions",
          models: applyPatch(freshBase, patchData as PatchData).map(transformModel),
        });
      }
    });
  });

  pi.on("session_shutdown", () => {
    revalidateAbort?.abort();
  });
}
