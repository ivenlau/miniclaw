import OpenAI from 'openai';
import type { LLMProvider, ChatCompletionOptions, ChatCompletionResult } from './types.js';
import { createLogger } from '../utils/logger.js';

export interface OpenAICompatConfig {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  name: string;
}

export class BaseOpenAICompatProvider implements LLMProvider {
  readonly name: string;
  protected client: OpenAI;
  protected defaultModel: string;
  protected log;

  constructor(config: OpenAICompatConfig) {
    this.name = config.name;
    this.defaultModel = config.defaultModel;
    this.log = createLogger(`llm:${config.name}`);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const model = options.model ?? this.defaultModel;
    this.log.debug({ model, messageCount: options.messages.length }, 'chat request');

    const response = await this.client.chat.completions.create({
      model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content ?? '',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      model: response.model,
    };
  }

  async *chatStream(options: ChatCompletionOptions): AsyncIterable<string> {
    const model = options.model ?? this.defaultModel;
    this.log.debug({ model }, 'chat stream request');

    const stream = await this.client.chat.completions.create({
      model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
