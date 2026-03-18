import type { LLMProvider } from './types.js';
import type { AppConfig } from '../config/schema.js';
import { createZhipuAIProvider } from './providers/zhipuai.js';
import { createMinimaxProvider } from './providers/minimax.js';
import { createDoubaoProvider } from './providers/doubao.js';
import { createOpenAIProvider } from './providers/openai.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm:registry');

const providers = new Map<string, LLMProvider>();
let activeProvider: string;

type ProviderFactory = (cfg: Record<string, string | undefined>) => LLMProvider;

const factories: Record<string, ProviderFactory> = {
  zhipuai: (cfg) => createZhipuAIProvider(cfg.apiKey!, cfg.model),
  minimax: (cfg) => createMinimaxProvider(cfg.apiKey!, cfg.model),
  doubao: (cfg) => createDoubaoProvider(cfg.apiKey!, cfg.endpointId!),
  openai: (cfg) => createOpenAIProvider(cfg.apiKey!, cfg.model),
};

export function initLLMProviders(config: AppConfig) {
  activeProvider = config.llm.provider;

  for (const [name, providerCfg] of Object.entries(config.llm.providers)) {
    const factory = factories[name];
    if (!factory) {
      log.warn({ name }, 'Unknown LLM provider, skipping');
      continue;
    }
    providers.set(name, factory(providerCfg as unknown as Record<string, string | undefined>));
    log.info({ name }, 'LLM provider registered');
  }
}

export function getLLMProvider(name?: string): LLMProvider {
  const key = name ?? activeProvider;
  const provider = providers.get(key);
  if (!provider) {
    throw new Error(`LLM provider "${key}" not found. Available: ${[...providers.keys()].join(', ')}`);
  }
  return provider;
}

export function setActiveProvider(name: string) {
  if (!providers.has(name)) {
    throw new Error(`LLM provider "${name}" not registered`);
  }
  activeProvider = name;
  log.info({ name }, 'Active LLM provider switched');
}

export function listProviders(): string[] {
  return [...providers.keys()];
}

export function getActiveProviderName(): string {
  return activeProvider;
}
