import { BaseOpenAICompatProvider } from '../base-openai-compat.js';

export function createDoubaoProvider(apiKey: string, endpointId: string) {
  return new BaseOpenAICompatProvider({
    name: 'doubao',
    apiKey,
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: endpointId || 'doubao-seed-2-0-pro-260215',
  });
}
