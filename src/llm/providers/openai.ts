import { BaseOpenAICompatProvider } from '../base-openai-compat.js';

export function createOpenAIProvider(apiKey: string, model?: string) {
  return new BaseOpenAICompatProvider({
    name: 'openai',
    apiKey,
    baseURL: 'https://api.openai.com/v1',
    defaultModel: model ?? 'gpt-4o',
  });
}
