import type { Model, Api } from '@mariozechner/pi-ai';
import type { AppConfig } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm:registry');

interface ModelEntry {
  model: Model<Api>;
  apiKey: string;
}

const models = new Map<string, ModelEntry>();
let activeProviderName: string;

/**
 * Build a Model<'openai-completions'> for OpenAI-compatible providers.
 */
function buildOpenAICompatModel(
  provider: string,
  baseUrl: string,
  modelId: string,
): Model<'openai-completions'> {
  return {
    id: modelId,
    name: `${provider}/${modelId}`,
    api: 'openai-completions',
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: 'max_tokens',
      supportsStrictMode: false,
    },
  };
}

/** Default model IDs per provider */
const DEFAULT_MODELS: Record<string, string> = {
  zhipuai: 'glm-4-flash',
  minimax: 'MiniMax-Text-01',
  doubao: 'doubao-1-5-pro-32k-250115',
  openai: 'gpt-4o-mini',
};

/** Default base URLs per provider */
const DEFAULT_BASE_URLS: Record<string, string> = {
  zhipuai: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimax.chat/v1',
  openai: 'https://api.openai.com/v1',
};

export function initLLMProviders(config: AppConfig) {
  activeProviderName = config.llm.provider;

  for (const [name, providerCfg] of Object.entries(config.llm.providers)) {
    const modelId = providerCfg.model ?? DEFAULT_MODELS[name] ?? 'unknown';

    // Doubao uses endpoint-based routing
    let baseUrl = providerCfg.baseUrl;
    if (name === 'doubao' && providerCfg.endpointId) {
      // Doubao baseUrl already includes the base; model ID is the endpoint ID
      baseUrl = providerCfg.baseUrl;
    }

    const model = buildOpenAICompatModel(
      name,
      baseUrl ?? DEFAULT_BASE_URLS[name] ?? providerCfg.baseUrl,
      name === 'doubao' && providerCfg.endpointId ? providerCfg.endpointId : modelId,
    );

    models.set(name, { model, apiKey: providerCfg.apiKey });
    log.info({ name, modelId: model.id }, 'LLM model registered');
  }
}

export function getLLMModel(name?: string): Model<Api> {
  const key = name ?? activeProviderName;
  const entry = models.get(key);
  if (!entry) {
    throw new Error(`LLM model "${key}" not found. Available: ${[...models.keys()].join(', ')}`);
  }
  return entry.model;
}

export function getLLMApiKey(name?: string): string {
  const key = name ?? activeProviderName;
  const entry = models.get(key);
  if (!entry) {
    throw new Error(`LLM model "${key}" not found.`);
  }
  return entry.apiKey;
}

export function setActiveProvider(name: string) {
  if (!models.has(name)) {
    throw new Error(`LLM provider "${name}" not registered. Available: ${[...models.keys()].join(', ')}`);
  }
  activeProviderName = name;
  log.info({ name }, 'Active LLM provider switched');
}

export function listProviders(): string[] {
  return [...models.keys()];
}

export function getActiveProviderName(): string {
  return activeProviderName;
}
