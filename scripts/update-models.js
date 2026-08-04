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
 * API key: the stored `parasail` credential in ~/.pi/agent/auth.json wins, then
 * the PARASAIL_API_KEY environment variable. The script refuses to run without one.
 */

import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// pi's agent directory: PI_CODING_AGENT_DIR (with ~ expansion) or ~/.pi/agent.
function piAgentDir() {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    return envDir.startsWith('~/') || envDir === '~'
      ? path.join(os.homedir(), envDir.slice(1))
      : envDir;
  }
  return path.join(os.homedir(), '.pi', 'agent');
}

const AUTH_JSON_PATH = path.join(piAgentDir(), 'auth.json');

/**
 * Resolve a configured value using pi's semantics (resolve-config-value.ts in
 * pi-mono): "!command" runs via the shell (10s timeout) and uses trimmed
 * stdout; "$VAR" / "${VAR}" interpolate environment variables ("$$" escapes a
 * literal "$", "$!" a literal "!"); anything else is a literal. Returns
 * undefined when a referenced env var is unset or a command fails.
 */
function resolveConfigValue(config, env) {
  if (typeof config !== 'string' || config.length === 0) return undefined;
  if (config.startsWith('!')) {
    try {
      const out = execSync(config.slice(1), {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  let resolved = '';
  let index = 0;
  while (index < config.length) {
    const dollar = config.indexOf('$', index);
    if (dollar < 0) {
      resolved += config.slice(index);
      break;
    }
    resolved += config.slice(index, dollar);
    const next = config[dollar + 1];
    let name;
    if (next === '$' || next === '!') {
      resolved += next;
      index = dollar + 2;
      continue;
    } else if (next === '{') {
      const end = config.indexOf('}', dollar + 2);
      if (end < 0) {
        resolved += '$';
        index = dollar + 1;
        continue;
      }
      const inner = config.slice(dollar + 2, end);
      if (!ENV_NAME_RE.test(inner)) {
        resolved += config.slice(dollar, end + 1);
        index = end + 1;
        continue;
      }
      name = inner;
      index = end + 1;
    } else {
      const match = config.slice(dollar + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) {
        resolved += '$';
        index = dollar + 1;
        continue;
      }
      name = match[0];
      index = dollar + 1 + name.length;
    }
    const value = (env && env[name]) || process.env[name] || undefined;
    if (value === undefined) return undefined;
    resolved += value;
  }
  return resolved;
}

/**
 * The API key, resolved the way pi itself resolves it for this provider: the
 * stored `parasail` credential in ~/.pi/agent/auth.json wins, then
 * the PARASAIL_API_KEY environment variable.
 */
function resolveApiKey() {
  try {
    const auth = JSON.parse(fs.readFileSync(AUTH_JSON_PATH, 'utf8'));
    const credential = auth?.parasail;
    if (credential && credential.type === 'api_key' && typeof credential.key === 'string') {
      const key = resolveConfigValue(credential.key, credential.env);
      if (key) return key;
    }
  } catch {
    // Missing or unparseable auth.json: fall through to the env var.
  }
  return process.env.PARASAIL_API_KEY || undefined;
}

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
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('No API key found: no `parasail` credential resolved from ' + AUTH_JSON_PATH + ' and PARASAIL_API_KEY is not set');
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
  if (patch.thinkingLevelMap !== undefined) result.thinkingLevelMap = { ...patch.thinkingLevelMap };
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
  if (!result.reasoning && result.thinkingLevelMap) {
    delete result.thinkingLevelMap;
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

// Grace period for delisted models: update-models.js moves models the API no
// longer lists into deprecated-models.json (stamped with deprecatedAt) instead
// of dropping them; the runtime appends them back so sessions and saved model
// settings keep working, and after 14 days they are evicted permanently.
const DEPRECATED_MODEL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Reconcile deprecated-models.json against the freshly fetched model list.
 * - in old models.json but not the API: moved into the deprecated file
 *   (deprecatedAt = now; preserved on repeat runs so the grace clock is not reset)
 * - back in the API: resurrected (dropped from the deprecated file)
 * - deprecatedAt older than 14 days: evicted permanently
 * Must run BEFORE the new models.json is written; it reads the old file itself.
 */
function updateDeprecatedModels(modelsJsonPath, newModels) {
  const deprecatedPath = path.join(path.dirname(modelsJsonPath), 'deprecated-models.json');

  let oldModels = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf8'));
    if (Array.isArray(parsed)) oldModels = parsed;
  } catch { /* first run: no previous models.json */ }

  let deprecated = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(deprecatedPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) deprecated = parsed;
  } catch { /* no graveyard yet */ }

  const currentIds = new Set(newModels.map(m => m.id));
  const now = new Date().toISOString();
  const added = [];
  const resurrected = [];
  const evicted = [];

  for (const old of oldModels) {
    if (old && old.id && !currentIds.has(old.id) && !deprecated[old.id]) {
      deprecated[old.id] = { ...old, deprecatedAt: now };
      added.push(old.id);
    }
  }

  for (const [id, entry] of Object.entries(deprecated)) {
    if (currentIds.has(id)) {
      delete deprecated[id];
      resurrected.push(id);
      continue;
    }
    const removedAt = Date.parse(entry && entry.deprecatedAt ? entry.deprecatedAt : '');
    if (Number.isNaN(removedAt) || Date.now() - removedAt > DEPRECATED_MODEL_TTL_MS) {
      delete deprecated[id];
      evicted.push(id);
    }
  }

  if (added.length > 0 || resurrected.length > 0 || evicted.length > 0) {
    fs.writeFileSync(deprecatedPath, JSON.stringify(deprecated, null, 2) + '\n');
    console.log('Updated deprecated-models.json ' + JSON.stringify({ added, resurrected, evicted }));
  }
}

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

    // Live API is authoritative — models absent from API are removed
    // (embedded data is already used for enrichment in transformApiModel)

    // Sort: reasoning models first, then by context window (descending), then name
    models.sort((a, b) => {
      if (a.reasoning !== b.reasoning) return b.reasoning - a.reasoning;
      if (b.contextWindow !== a.contextWindow) return b.contextWindow - a.contextWindow;
      return a.name.localeCompare(b.name);
    });

    // Save models.json (pure API output, no patch/custom baked in)
    // Move delisted models to deprecated-models.json BEFORE models.json is overwritten
    updateDeprecatedModels(MODELS_JSON_PATH, models);
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
