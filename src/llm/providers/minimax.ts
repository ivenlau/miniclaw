import { BaseOpenAICompatProvider } from '../base-openai-compat.js';

export function createMinimaxProvider(apiKey: string, model?: string) {
  return new BaseOpenAICompatProvider({
    name: 'minimax',
    apiKey,
    baseURL: 'https://api.minimax.chat/v1',
    defaultModel: model ?? 'MiniMax-M2.5',
  });
}
