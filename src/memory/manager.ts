import { readCoreMemory, appendCoreMemory, appendTopicFile, listTopicFiles } from './long-term.js';
import { searchTopics } from './searcher.js';
import { eventBus } from '../utils/events.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('memory:manager');

export function getCoreMemory(): string {
  return readCoreMemory();
}

export function searchTopicMemories(query: string): string[] {
  const matches = searchTopics(query);
  return matches.map(m => m.content);
}

export function saveCoreMemory(content: string) {
  appendCoreMemory(content);
  eventBus.emit('memory:updated', { file: 'memory.md' });
  log.info('Core memory saved');
}

export function saveTopicMemory(topicName: string, content: string) {
  appendTopicFile(topicName, content);
  eventBus.emit('memory:updated', { file: `memory/${topicName}.md` });
  log.info({ topicName }, 'Topic memory saved');
}

export function listMemoryTopics(): string[] {
  return listTopicFiles();
}

export function searchMemory(query: string): { core: string; topics: Array<{ name: string; content: string }> } {
  const core = readCoreMemory();
  const topicMatches = searchTopics(query);

  return {
    core,
    topics: topicMatches.map(m => ({ name: m.filename, content: m.content })),
  };
}
