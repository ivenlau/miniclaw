import { complete, stream } from '@mariozechner/pi-ai';
import type { Model, Api, Context, AssistantMessage, AssistantMessageEvent } from '@mariozechner/pi-ai';
import type { AssistantMessageEventStream } from '@mariozechner/pi-ai';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm:pi-ai');

/**
 * Thin wrapper around pi-ai's complete() and stream() for direct LLM calls
 * (memory extraction, cron parsing, persona generation, etc.)
 */
export async function llmComplete(
  model: Model<Api>,
  context: Context,
  options?: { temperature?: number; maxTokens?: number; apiKey?: string },
): Promise<AssistantMessage> {
  log.debug({ model: model.id, msgCount: context.messages.length }, 'complete request');
  return complete(model, context, {
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    apiKey: options?.apiKey,
  });
}

export function llmStream(
  model: Model<Api>,
  context: Context,
  options?: { temperature?: number; maxTokens?: number; apiKey?: string },
): AssistantMessageEventStream {
  log.debug({ model: model.id }, 'stream request');
  return stream(model, context, {
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    apiKey: options?.apiKey,
  });
}

/** Extract text content from an AssistantMessage */
export function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map(c => c.text)
    .join('');
}
