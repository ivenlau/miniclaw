import { listTopicFiles, readTopicFile } from './long-term.js';
import { getConfig } from '../config/loader.js';
import type { TopicMatch } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('memory:searcher');

export function searchTopics(query: string): TopicMatch[] {
  const config = getConfig();
  const maxFiles = config.memory.longTerm.maxTopicFilesPerQuery;

  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const topics = listTopicFiles();
  const scored: TopicMatch[] = [];

  for (const topic of topics) {
    let score = 0;

    // Score filename match
    for (const keyword of keywords) {
      if (topic.toLowerCase().includes(keyword.toLowerCase())) {
        score += 3;
      }
    }

    // Score content match
    const content = readTopicFile(topic);
    for (const keyword of keywords) {
      const regex = new RegExp(keyword, 'gi');
      const matches = content.match(regex);
      if (matches) {
        score += matches.length;
      }
    }

    if (score > 0) {
      scored.push({ filename: topic, score, content });
    }
  }

  // Sort by score descending, return top N
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, maxFiles);

  log.debug({ keywords, matches: results.length }, 'Topic search completed');
  return results;
}

function extractKeywords(text: string): string[] {
  // Simple keyword extraction: split on spaces/punctuation, filter short words
  const words = text
    .replace(/[^\w\u4e00-\u9fff\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .map(w => w.toLowerCase());

  // Deduplicate
  return [...new Set(words)];
}
