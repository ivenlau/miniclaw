import type { ChatMessage } from '../llm/types.js';

// Short-term memory is managed directly in session.history
// This module provides utility functions for working with it

export function trimHistory(history: ChatMessage[], maxMessages: number): ChatMessage[] {
  if (history.length <= maxMessages) return history;
  return history.slice(-maxMessages);
}

export function getRecentContext(history: ChatMessage[], count = 5): string {
  const recent = history.slice(-count);
  return recent.map(m => `${m.role}: ${m.content}`).join('\n');
}
