import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('memory:long-term');

function getMemoryConfig() {
  return getConfig().memory.longTerm;
}

export function readCoreMemory(): string {
  const { coreFile } = getMemoryConfig();
  const filePath = path.resolve(coreFile);

  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeCoreMemory(content: string) {
  const { coreFile } = getMemoryConfig();
  const filePath = path.resolve(coreFile);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  log.info('Core memory updated');
}

export function appendCoreMemory(newContent: string) {
  const existing = readCoreMemory();
  const updated = existing ? `${existing}\n\n${newContent}` : newContent;

  const { maxCoreLines } = getMemoryConfig();
  const lines = updated.split('\n');

  if (lines.length > maxCoreLines) {
    log.warn({ lines: lines.length, max: maxCoreLines }, 'Core memory exceeds max lines');
  }

  writeCoreMemory(updated);
}

export function readTopicFile(topicName: string): string {
  const { topicDir } = getMemoryConfig();
  const filePath = path.resolve(topicDir, `${topicName}.md`);

  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeTopicFile(topicName: string, content: string) {
  const { topicDir } = getMemoryConfig();
  const dirPath = path.resolve(topicDir);
  const filePath = path.join(dirPath, `${topicName}.md`);

  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  log.info({ topicName }, 'Topic memory updated');
}

export function appendTopicFile(topicName: string, newContent: string) {
  const existing = readTopicFile(topicName);
  const updated = existing ? `${existing}\n\n${newContent}` : `# ${topicName}\n\n${newContent}`;
  writeTopicFile(topicName, updated);
}

export function listTopicFiles(): string[] {
  const { topicDir } = getMemoryConfig();
  const dirPath = path.resolve(topicDir);

  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}
