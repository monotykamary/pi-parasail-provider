#!/usr/bin/env node
/**
 * Update Parasail models from API
 *
 * Fetches models from https://api.parasail.io/v1/models and pricing from
 * https://www.saas.parasail.io/api/v1/prices/serverlessEndpoints, then updates:
 * - models.json: Provider model definitions (enriched with pricing & compat)
 * - README.md: Model table in the Available Models section
 *
 * The /v1/models API returns basic model info (id, object, owned_by)
 * but does NOT include pricing, context length, or max output tokens.
 * The pricing endpoint provides inputCost, outputCost, cachedCost, contextLength,
 * and tags (e.g. "multimodal" for vision models).
 *
 * patch.json and custom-models.json are applied at runtime by the provider.
 * They are NOT baked into models.json, but ARE used to generate the README table.
 *
 * Requires PARASAIL_API_KEY environment variable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODELS_API_URL = 'https://api.parasail.io/v1/models';
const PRICING_API_URL = 'https://www.saas.parasail.io/api/v1/prices/serverlessEndpoints';
const MODELS_JSON_PATH = path.join(__dirname, '..', 'models.json');
const PATCH_JSON_PATH = path.join(__dirname, '..', 'patch.json');
const CUSTOM_MODELS_JSON_PATH = path.join(__dirname, '..', 'custom-models.json');
const README_PATH = path.join(__dirname, '..', 'README.md');

// Non-LLM model prefixes to skip (embedding, TTS, UI agent models)
const SKIP_PREFIXES = ['parasail-bge-', 'parasail-resemble-', 'parasail-ui-tars-'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ Saved ${path.basename(filePath)}`);
}

// ─── API fetch ───────────────────────────────────────────────────────────────

async function fetchModels() {
  const apiKey = process.env.PARASAIL_API_KEY;
  if (!apiKey) {
    throw new Error('PARASAIL_API_KEY environment variable is required');
  }

  console.log(`Fetching models from ${MODELS_API_URL}...`);
  const response = await fetch(MODELS_API_URL, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const models = data.data || [];
  console.log(`✓ Fetched ${models.length} models from API`);
  return models;
}

async function fetchPricing() {
  console.log(`Fetching pricing from ${PRICING_API_URL}...`);
  const response = await fetch(PRICING_API_URL);

  if (!response.ok) {
    throw new Error(`Pricing API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const pricing = new Map();
  for (const entry of data) {
    const alias = entry.externalAlias;
    if (!alias || !alias.startsWith('parasail-')) continue;
    if (SKIP_PREFIXES.some(prefix => alias.startsWith(prefix))) continue;
    pricing.set(alias, {
      contextLength: entry.contextLength || 0,
      inputCost: entry.inputCost ?? 0,
      outputCost: entry.outputCost ?? 0,
      cachedCost: entry.cachedCost ?? 0,
      tags: entry.tags || [],
    });
  }
  console.log(`✓ Fetched pricing for ${pricing.size} models`);
  return pricing;
}

// ─── Transform API model → models.json entry ────────────────────────────────

function transformApiModel(apiModel, existingModelsMap, pricing) {
  const id = apiModel.id;

  // Skip non-LLM models
  if (SKIP_PREFIXES.some(prefix => id.startsWith(prefix))) return null;

  // Only use parasail- prefixed IDs (cleaner aliases)
  if (!id.startsWith('parasail-')) return null;

  // Start from existing model data if we have it (preserves pricing, compat, etc.)
  if (existingModelsMap[id]) {
    const existing = { ...existingModelsMap[id] };
    // Update from live pricing data
    const p = pricing.get(id);
    if (p) {
      existing.cost = {
        input: p.inputCost,
        output: p.outputCost,
        cacheRead: p.cachedCost,
        cacheWrite: 0,
      };
      if (p.contextLength) {
        existing.contextWindow = p.contextLength;
      }
      if (p.tags.includes('multimodal') && !existing.input.includes('image')) {
        existing.input = [...existing.input, 'image'];
      }
    }
    return existing;
  }

  // New model — build from pricing data + sensible defaults
  // models.json is the source of truth for curated specs (reasoning, thinkingFormat, etc.)
  // New models get defaults here; curate models.json manually after discovery.
  const p = pricing.get(id);
  const input = p?.tags?.includes('multimodal') ? ['text', 'image'] : ['text'];

  const model = {
    id,
    name: generateDisplayName(id),
    reasoning: false,
    input,
    cost: {
      input: p?.inputCost ?? 0,
      output: p?.outputCost ?? 0,
      cacheRead: p?.cachedCost ?? 0,
      cacheWrite: 0,
    },
    contextWindow: p?.contextLength || 131_072,
    maxTokens: 16_384,
  };

  // Default compat settings (can be refined in models.json or patch.json)
  model.compat = {
    maxTokensField: 'max_completion_tokens',
    supportsDeveloperRole: false,
    supportsStore: false,
  };

  return model;
}

function generateDisplayName(id) {
  const raw = id.replace(/^parasail-/, '');
  return raw
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Patch & Custom Models ──────────────────────────────────────────────────

function applyPatch(model, patch) {
  const result = { ...model };
  if (patch.name !== undefined) result.name = patch.name;
  if (patch.reasoning !== undefined) result.reasoning = patch.reasoning;
  if (patch.input !== undefined) result.input = patch.input;
  if (patch.contextWindow !== undefined) result.contextWindow = patch.contextWindow;
  if (patch.maxTokens !== undefined) result.maxTokens = patch.maxTokens;
  if (patch.cost) {
    result.cost = {
      input: patch.cost.input ?? result.cost.input,
      output: patch.cost.output ?? result.cost.output,
      cacheRead: patch.cost.cacheRead ?? result.cost.cacheRead,
      cacheWrite: patch.cost.cacheWrite ?? result.cost.cacheWrite,
    };
  }
  if (patch.compat) {
    result.compat = { ...(result.compat || {}), ...patch.compat };
  }
  if (!result.reasoning && result.compat?.thinkingFormat) {
    delete result.compat.thinkingFormat;
  }
  if (result.compat && Object.keys(result.compat).length === 0) {
    delete result.compat;
  }
  return result;
}

function buildModels(baseModels, customModels, patchData) {
  const modelMap = new Map();
  for (const model of baseModels) {
    modelMap.set(model.id, model);
  }
  for (const [id, patchEntry] of Object.entries(patchData)) {
    const existing = modelMap.get(id);
    if (existing) {
      modelMap.set(id, applyPatch(existing, patchEntry));
    }
  }
  for (const model of customModels) {
    const existing = modelMap.get(model.id);
    const patchEntry = patchData[model.id];
    if (existing && patchEntry) {
      modelMap.set(model.id, applyPatch(model, patchEntry));
    } else if (existing) {
      modelMap.set(model.id, model);
    } else if (patchEntry) {
      modelMap.set(model.id, applyPatch(model, patchEntry));
    } else {
      modelMap.set(model.id, model);
    }
  }
  return Array.from(modelMap.values());
}

// ─── README generation ──────────────────────────────────────────────────────

function formatContext(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return n.toString();
}

function formatCost(cost) {
  if (cost === 0) return 'Free';
  if (cost === null || cost === undefined) return '-';
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function generateReadmeTable(models) {
  const lines = [
    '| Model | Context | Reasoning | Input | Max Output | Input $/M | Output $/M | Cache $/M |',
    '|-------|---------|-----------|-------|------------|-----------|------------|-----------|',
  ];

  for (const model of models) {
    const context = formatContext(model.contextWindow);
    const reasoning = model.reasoning ? '✅' : '❌';
    const input = model.input.includes('image') ? 'Text + Image' : 'Text';
    const maxOutput = formatContext(model.maxTokens);
    const inputCost = formatCost(model.cost.input);
    const outputCost = formatCost(model.cost.output);
    const cacheCost = formatCost(model.cost.cacheRead);

    lines.push(`| ${model.name} | ${context} | ${reasoning} | ${input} | ${maxOutput} | ${inputCost} | ${outputCost} | ${cacheCost} |`);
  }

  return lines.join('\n');
}

function updateReadme(models) {
  let readme = fs.readFileSync(README_PATH, 'utf8');
  const newTable = generateReadmeTable(models);

  const tableRegex = /(## Available Models\n\n)\| Model \| Context \| Reasoning[^\n]+\|\n\|[-| ]+\|(\n\|[^\n]+\|)*\n*/;

  if (tableRegex.test(readme)) {
    readme = readme.replace(tableRegex, (match, header) => `${header}${newTable}\n\n`);
    fs.writeFileSync(README_PATH, readme);
    console.log('✓ Updated README.md');
  } else {
    console.warn('⚠ Could not find model table in "## Available Models" section');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const [apiModels, pricing] = await Promise.all([
      fetchModels(),
      fetchPricing(),
    ]);

    // Load existing models.json for compat preservation
    const existingModels = loadJson(MODELS_JSON_PATH);
    const existingModelsMap = {};
    for (const m of (Array.isArray(existingModels) ? existingModels : [])) {
      existingModelsMap[m.id] = m;
    }

    // Transform API models, preserving existing data where available
    let models = apiModels
      .map(m => transformApiModel(m, existingModelsMap, pricing))
      .filter(m => m !== null);

    // Keep models from models.json that are NOT in the API response
    const apiIds = new Set(apiModels.map(m => m.id));
    for (const existing of Object.values(existingModelsMap)) {
      if (!apiIds.has(existing.id)) {
        // Still update pricing from live data
        const p = pricing.get(existing.id);
        if (p) {
          existing.cost = {
            input: p.inputCost,
            output: p.outputCost,
            cacheRead: p.cachedCost,
            cacheWrite: 0,
          };
          if (p.contextLength) {
            existing.contextWindow = p.contextLength;
          }
          if (p.tags.includes('multimodal') && !existing.input.includes('image')) {
            existing.input = [...existing.input, 'image'];
          }
        }
        models.push(existing);
      }
    }

    // Sort: reasoning models first, then by context window (descending), then name
    models.sort((a, b) => {
      if (a.reasoning !== b.reasoning) return b.reasoning - a.reasoning;
      if (b.contextWindow !== a.contextWindow) return b.contextWindow - a.contextWindow;
      return a.name.localeCompare(b.name);
    });

    // Save models.json (pure API output, no patch/custom baked in)
    saveJson(MODELS_JSON_PATH, models);

    // Build full model list for README: base → patch → custom
    const patchData = loadJson(PATCH_JSON_PATH);
    const customModels = loadJson(CUSTOM_MODELS_JSON_PATH);
    const readmeModels = buildModels(models, Array.isArray(customModels) ? customModels : [], patchData);
    readmeModels.sort((a, b) => a.name.localeCompare(b.name));

    // Update README
    updateReadme(readmeModels);

    // Summary
    const newIds = new Set(models.map(m => m.id));
    const oldIds = new Set(Object.keys(existingModelsMap));
    const added = [...newIds].filter(id => !oldIds.has(id));
    const removed = [...oldIds].filter(id => !newIds.has(id));

    console.log('\n--- Summary ---');
    console.log(`Total models: ${models.length}`);
    console.log(`Reasoning models: ${models.filter(m => m.reasoning).length}`);
    console.log(`Vision models: ${models.filter(m => m.input.includes('image')).length}`);
    if (added.length > 0) console.log(`New models: ${added.join(', ')}`);
    if (removed.length > 0) console.log(`Removed models: ${removed.join(', ')}`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
