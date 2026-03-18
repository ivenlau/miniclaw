import type { ChatAdapter } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('chat:registry');
const adapters = new Map<string, ChatAdapter>();

export function registerAdapter(adapter: ChatAdapter) {
  adapters.set(adapter.name, adapter);
  log.info({ name: adapter.name }, 'Chat adapter registered');
}

export function getAdapter(name: string): ChatAdapter | undefined {
  return adapters.get(name);
}

export function getAllAdapters(): ChatAdapter[] {
  return [...adapters.values()];
}

export async function startAllAdapters() {
  for (const adapter of adapters.values()) {
    try {
      await adapter.start();
      log.info({ name: adapter.name }, 'Chat adapter started');
    } catch (err) {
      log.error({ err, name: adapter.name }, 'Chat adapter failed to start, skipping');
    }
  }
}

export async function stopAllAdapters() {
  for (const adapter of adapters.values()) {
    await adapter.stop();
    log.info({ name: adapter.name }, 'Chat adapter stopped');
  }
}
