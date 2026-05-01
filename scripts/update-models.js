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
 * patch.json is applied at runtime by the provider — not baked into models.json.
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
const README_PATH = path.join(__dirname, '..', 'README.md');

// Non-LLM model prefixes to skip (embedding, TTS, UI agent models)
const SKIP_PREFIXES = ['parasail-bge-', 'parasail-resemble-', 'parasail-ui-tars-'];

// ─── Model metadata ─────────────────────────────────────────────────────────
// Known specs for models — reasoning, thinking format, max tokens, etc.
// Pricing and context window come from the pricing endpoint.

const MODEL_SPECS = {
  'parasail-deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro',
    reasoning: true,
    maxTokens: 384_000,
    thinkingFormat: 'openai',
    supportsReasoningEffort: true,
  },
  'parasail-deepseek-v4-flash': {
    name: 'DeepSeek V4 Flash',
    reasoning: true,
    maxTokens: 384_000,
    thinkingFormat: 'openai',
    supportsReasoningEffort: true,
  },
  'parasail-qwen35-397b-a17b': {
    name: 'Qwen 3.5 397B (A17B)',
    reasoning: true,
    maxTokens: 32_768,
    thinkingFormat: 'qwen',
  },
  'parasail-qwen3-235b-a22b-instruct-2507': {
    name: 'Qwen3 235B (A22B)',
    reasoning: true,
    maxTokens: 32_768,
    thinkingFormat: 'qwen',
  },
  'parasail-qwen3-vl-235b-a22b-instruct': {
    name: 'Qwen3-VL 235B (A22B)',
    reasoning: true,
    maxTokens: 32_768,
    thinkingFormat: 'qwen',
  },
  'parasail-qwen3-coder-next': {
    name: 'Qwen3 Coder Next',
    reasoning: true,
    maxTokens: 32_768,
    thinkingFormat: 'qwen',
  },
  'parasail-qwen-3-next-80b-instruct': {
    name: 'Qwen3 Next 80B (A3B)',
    reasoning: true,
    maxTokens: 32_768,
    thinkingFormat: 'qwen',
  },
  'parasail-qwen3p5-35b-a3b': {
    name: 'Qwen 3.5 35B (A3B)',
    reasoning: true,
    maxTokens: 32_768,
    thinkingFormat: 'qwen',
  },
  'parasail-qwen3p6-35b-a3b': {
    name: 'Qwen 3.6 35B (A3B)',
    reasoning: true,
    maxTokens: 32_768,
    thinkingFormat: 'qwen',
  },
  'parasail-qwen3vl-8b-instruct': {
    name: 'Qwen3-VL 8B',
    reasoning: true,
    maxTokens: 8_192,
    thinkingFormat: 'qwen',
  },
  'parasail-qwen25-vl-72b-instruct': {
    name: 'Qwen2.5-VL 72B',
    reasoning: false,
    maxTokens: 8_192,
  },
  'parasail-glm-51': {
    name: 'GLM 5.1',
    reasoning: true,
    maxTokens: 16_384,
    thinkingFormat: 'zai',
  },
  'parasail-glm-5': {
    name: 'GLM 5',
    reasoning: true,
    maxTokens: 16_384,
    thinkingFormat: 'zai',
  },
  'parasail-glm47': {
    name: 'GLM 4.7',
    reasoning: true,
    maxTokens: 16_384,
    thinkingFormat: 'zai',
  },
  'parasail-kimi-k26': {
    name: 'Kimi K2.6',
    reasoning: true,
    maxTokens: 16_384,
  },
  'parasail-kimi-k26-nvfp4': {
    name: 'Kimi K2.6 NVFP4',
    reasoning: true,
    maxTokens: 16_384,
  },
  'parasail-kimi-k25': {
    name: 'Kimi K2.5',
    reasoning: true,
    maxTokens: 16_384,
  },
  'parasail-minimax-m25': {
    name: 'MiniMax M2.5',
    reasoning: true,
    maxTokens: 16_384,
  },
  'parasail-trinity-large-thinking': {
    name: 'Trinity Large Thinking',
    reasoning: true,
    maxTokens: 16_384,
    thinkingFormat: 'openai',
  },
  'parasail-deepseek-v32': {
    name: 'DeepSeek V3.2',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-llama-4-maverick-instruct-fp8': {
    name: 'Llama 4 Maverick 17B-128E',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-llama-33-70b-fp8': {
    name: 'Llama 3.3 70B',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-gemma-4-31b-it': {
    name: 'Gemma 4 31B',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-gemma-4-26b-a4b-it': {
    name: 'Gemma 4 26B (A4B)',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-gemma3-27b-it': {
    name: 'Gemma 3 27B',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-mistral-small-32-24b': {
    name: 'Mistral Small 3.2 24B',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-gpt-oss-120b': {
    name: 'GPT-OSS 120B',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-gpt-oss-20b': {
    name: 'GPT-OSS 20B',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-stepfun35-flash': {
    name: 'Step 3.5 Flash',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-skyfall-31b-v42': {
    name: 'Skyfall 31B v4.2',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-skyfall-36b-v2-fp8': {
    name: 'Skyfall 36B v2',
    reasoning: false,
    maxTokens: 16_384,
  },
  'parasail-cydonia-24-v41': {
    name: 'Cydonia 24B v4.1',
    reasoning: false,
    maxTokens: 16_384,
  },
};

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

  // New model — build from known specs + pricing
  const specs = MODEL_SPECS[id] || {};
  const p = pricing.get(id);
  const input = specs.input || (p?.tags?.includes('multimodal') ? ['text', 'image'] : ['text']);

  const model = {
    id,
    name: specs.name || generateDisplayName(id),
    reasoning: specs.reasoning || false,
    input,
    cost: {
      input: p?.inputCost ?? 0,
      output: p?.outputCost ?? 0,
      cacheRead: p?.cachedCost ?? 0,
      cacheWrite: 0,
    },
    contextWindow: p?.contextLength || specs.contextWindow || 131_072,
    maxTokens: specs.maxTokens || 16_384,
  };

  // Add compat settings
  model.compat = {
    maxTokensField: 'max_completion_tokens',
    supportsDeveloperRole: false,
    supportsStore: false,
  };

  if (model.reasoning && specs.thinkingFormat) {
    model.compat.thinkingFormat = specs.thinkingFormat;
  }
  if (specs.supportsReasoningEffort) {
    model.compat.supportsReasoningEffort = true;
  }

  return model;
}

function generateDisplayName(id) {
  const raw = id.replace(/^parasail-/, '');
  return raw
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
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

    // Save models.json
    saveJson(MODELS_JSON_PATH, models);

    // Update README
    updateReadme(models);

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
