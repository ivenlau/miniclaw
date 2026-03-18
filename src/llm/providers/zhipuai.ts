import { BaseOpenAICompatProvider } from '../base-openai-compat.js';

export function createZhipuAIProvider(apiKey: string, model?: string) {
  return new BaseOpenAICompatProvider({
    name: 'zhipuai',
    apiKey,
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: model ?? 'glm-4.7',
  });
}
