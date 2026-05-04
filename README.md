# pi-parasail-provider

A [pi](https://github.com/badlogic/pi-mono) extension that registers [Parasail](https://parasail.io/) as a custom provider. Access top open-source models — DeepSeek, Qwen, GLM, Kimi, Llama, Gemma, Mistral, and more — through Parasail's OpenAI-compatible API.

## Features

- **Wide Model Selection** — 30+ models from DeepSeek, Qwen, GLM, Kimi, Llama, Gemma, Mistral, MiniMax, and more
- **Reasoning Models** — DeepSeek V4, Qwen3, GLM 5, Kimi K2.5/K2.6, Trinity, MiniMax with thinking mode
- **Vision Support** — Qwen3-VL, Gemma 4, Qwen2.5-VL accept image + text input
- **Unified API** — OpenAI-compatible completions endpoint
- **Long Context** — DeepSeek V4 (1M), Llama 4 Maverick (1M), MiniMax M2.5 (1M)

## Installation

### Option 1: Using `pi install` (Recommended)

Install directly from GitHub:

```bash
pi install git:github.com/monotykamary/pi-parasail-provider
```

Then set your API key and run pi:
```bash
# Recommended: add to auth.json
# See Authentication section below

# Or set as environment variable
export PARASAIL_API_KEY=your-api-key-here

pi
```

Get your API key at [parasail.io](https://parasail.io/).

### Option 2: Manual Clone

1. Clone this repository:
   ```bash
   git clone https://github.com/monotykamary/pi-parasail-provider.git
   cd pi-parasail-provider
   ```

2. Set your Parasail API key:
   ```bash
   # Recommended: add to auth.json
   # See Authentication section below

   # Or set as environment variable
   export PARASAIL_API_KEY=your-api-key-here
   ```

3. Run pi with the extension:
   ```bash
   pi -e /path/to/pi-parasail-provider
   ```

## Available Models

| Model | Context | Reasoning | Input | Max Output | Input $/M | Output $/M | Cache $/M |
|-------|---------|-----------|-------|------------|-----------|------------|-----------|
| Cydonia 24B v4.1 | 131K | ❌ | Text | 16K | $0.30 | $0.50 | $0.15 |
| DeepSeek V3.2 | 164K | ❌ | Text | 16K | $0.28 | $0.45 | $0.13 |
| DeepSeek V4 Flash | 1M | ✅ | Text | 384K | $0.14 | $0.28 | $0.07 |
| DeepSeek V4 Pro | 1M | ✅ | Text | 384K | $1.74 | $3.48 | $0.87 |
| Gemma 3 27B | 131K | ❌ | Text + Image | 16K | $0.08 | $0.45 | $0.04 |
| Gemma 4 26B (A4B) | 262K | ❌ | Text + Image | 16K | $0.13 | $0.40 | $0.05 |
| Gemma 4 31B | 262K | ❌ | Text + Image | 16K | $0.14 | $0.40 | $0.07 |
| GLM 4.7 | 203K | ✅ | Text | 16K | $0.45 | $2.10 | $0.11 |
| GLM 5 | 203K | ✅ | Text | 16K | $1.00 | $3.20 | $0.20 |
| GLM 5.1 | 203K | ✅ | Text | 16K | $1.40 | $4.40 | $0.26 |
| GPT-OSS 120B | 131K | ❌ | Text | 16K | $0.10 | $0.75 | $0.06 |
| GPT-OSS 20B | 131K | ❌ | Text | 16K | $0.04 | $0.20 | $0.02 |
| Kimi K2.5 | 262K | ✅ | Text + Image | 16K | $0.60 | $2.80 | $0.20 |
| Kimi K2.6 | 262K | ✅ | Text + Image | 16K | $0.80 | $3.50 | $0.20 |
| Kimi K2.6 NVFP4 | 262K | ✅ | Text + Image | 16K | $0.90 | $3.75 | $0.25 |
| Llama 3.3 70B | 131K | ❌ | Text | 16K | $0.22 | $0.50 | $0.11 |
| Llama 4 Maverick 17B-128E | 524K | ❌ | Text + Image | 16K | $0.35 | $1.00 | $0.17 |
| MiniMax M2.5 | 197K | ✅ | Text | 16K | $0.30 | $1.20 | $0.03 |
| Mistral Small 3.2 24B | 131K | ❌ | Text + Image | 16K | $0.09 | $0.60 | $0.05 |
| Qwen 3.5 35B (A3B) | 262K | ✅ | Text + Image | 33K | $0.15 | $1.00 | $0.05 |
| Qwen 3.5 397B (A17B) | 262K | ✅ | Text + Image | 33K | $0.50 | $3.60 | $0.30 |
| Qwen 3.6 35B (A3B) | 262K | ✅ | Text + Image | 33K | $0.15 | $1.00 | $0.05 |
| Qwen2.5-VL 72B | 128K | ❌ | Text + Image | 8K | $0.80 | $1.00 | $0.40 |
| Qwen3 235B (A22B) | 131K | ✅ | Text | 33K | $0.10 | $0.60 | $0.05 |
| Qwen3 Coder Next | 262K | ✅ | Text | 33K | $0.12 | $0.80 | $0.07 |
| Qwen3 Embedding | 41K | ❌ | Text | 16K | $0.01 | Free | Free |
| Qwen3 Next 80B (A3B) | 262K | ✅ | Text | 33K | $0.10 | $1.10 | $0.07 |
| Qwen3-VL 235B (A22B) | 131K | ✅ | Text + Image | 33K | $0.21 | $1.90 | $0.10 |
| Qwen3-VL 8B | 262K | ✅ | Text + Image | 8K | $0.25 | $0.75 | $0.12 |
| Skyfall 31B v4.2 | 131K | ❌ | Text | 16K | $0.55 | $0.80 | $0.25 |
| Skyfall 36B v2 | 33K | ❌ | Text | 16K | $0.55 | $0.80 | $0.25 |
| Step 3.5 Flash | 262K | ❌ | Text | 16K | $0.10 | $0.30 | $0.02 |
| Trinity Large Thinking | 262K | ✅ | Text | 16K | $0.22 | $0.85 | $0.06 |

*Pricing fetched live from [Parasail's pricing API](https://www.saas.parasail.io/api/v1/prices/serverlessEndpoints). Prices are per million tokens and subject to change.*

## Usage

After loading the extension, use the `/model` command in pi to select your preferred model:

```
/model parasail parasail-deepseek-v4-pro
```

Or start pi directly with a Parasail model:

```bash
pi --provider parasail --model parasail-deepseek-v4-pro
```

### Thinking Mode

Reasoning models (DeepSeek V4, Qwen3, GLM, Kimi) support both thinking and non-thinking modes. In pi, reasoning models automatically use the appropriate thinking format:

- **DeepSeek V4** — `openai` thinking format (`thinking: {type: "enabled"}`)
- **Qwen3/Qwen3.5** — `qwen` thinking format
- **GLM** — `zai` thinking format

## Authentication

The Parasail API key can be configured in multiple ways (resolved in this order):

1. **`auth.json`** (recommended) — Add to `~/.pi/agent/auth.json`:
   ```json
   { "parasail": { "type": "api_key", "key": "your-api-key" } }
   ```
   The `key` field supports literal values, env var names, and shell commands (prefix with `!`). See [pi's auth file docs](https://github.com/badlogic/pi-mono) for details.
2. **Runtime override** — Use the `--api-key` CLI flag
3. **Environment variable** — Set `PARASAIL_API_KEY`

Get your API key at [parasail.io](https://parasail.io/).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PARASAIL_API_KEY` | No | Your Parasail API key (fallback if not in auth.json) |

## Configuration

Add to your pi configuration for automatic loading:

```json
{
  "extensions": [
    "/path/to/pi-parasail-provider"
  ]
}
```

### Compat Settings

Parasail's API uses OpenAI-compatible settings:

- **`thinkingFormat`** — Set per-model family: `"openai"` (DeepSeek V4), `"qwen"` (Qwen3), `"zai"` (GLM)
- **`maxTokensField: "max_completion_tokens"`** — All models use `max_completion_tokens`
- **`supportsDeveloperRole: false`** — All models use `system` role, not `developer`
- **`supportsStore: false`** — All models don't support the `store` parameter

### Patch Overrides

The `patch.json` file contains overrides that are applied on top of `models.json` data at runtime. This is useful for:
- Correcting API-derived values (e.g., marking a model as reasoning-capable)
- Adding compat settings that the API doesn't provide
- Overriding pricing/context window when specs change

## Updating Models

Run the update script to fetch the latest models from Parasail's API:

```bash
export PARASAIL_API_KEY=your-api-key
node scripts/update-models.js
```

This will:
1. Fetch models from `https://api.parasail.io/v1/models`
2. Preserve pricing, compat, and metadata from existing `models.json`
3. Apply overrides from `patch.json` at runtime
4. Update `models.json` and the README model table

A GitHub Actions workflow runs this daily and creates a PR if models have changed.

## License

MIT
