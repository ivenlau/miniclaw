import type { Message } from '@mariozechner/pi-ai';

// Short-term memory is managed directly in session.history
// This module provides utility functions for working with it

export function trimHistory(history: Message[], maxMessages: number): Message[] {
  if (history.length <= maxMessages) return history;
  return history.slice(-maxMessages);
}

export function getRecentContext(history: Message[], count = 5): string {
  const recent = history.slice(-count);
  return recent.map(m => {
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => (c as any).text).join('');
      return `user: ${text}`;
    }
    if (m.role === 'assistant') {
      const text = m.content.filter(c => c.type === 'text').map(c => (c as any).text).join('');
      return `assistant: ${text}`;
    }
    return '';
  }).filter(Boolean).join('\n');
}
