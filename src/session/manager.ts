import path from 'node:path';
import type { Session } from './types.js';
import type { ChatMessage } from '../llm/types.js';
import { getConfig } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('session');
const sessions = new Map<string, Session>();

function makeSessionKey(platform: string, chatId: string): string {
  return `${platform}:${chatId}`;
}

export function getOrCreateSession(platform: string, chatId: string, userId: string): Session {
  const key = makeSessionKey(platform, chatId);
  let session = sessions.get(key);

  if (!session) {
    const config = getConfig();
    const rawWs = config.workspace.default.startsWith('~')
      ? config.workspace.default.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? '.')
      : config.workspace.default;
    const defaultWs = path.resolve(rawWs);
    session = {
      id: key,
      platform,
      chatId,
      userId,
      workspace: defaultWs,
      cliTool: config.cli.defaultTool,
      history: [],
      activeCLIProcess: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    sessions.set(key, session);
    log.debug({ key }, 'Session created');
  }

  session.lastActiveAt = Date.now();
  return session;
}

export function addToHistory(session: Session, message: ChatMessage) {
  const config = getConfig();
  const max = config.memory.shortTerm.maxMessages;

  session.history.push(message);

  // Sliding window: keep only the last `max` messages
  if (session.history.length > max) {
    session.history = session.history.slice(-max);
  }
}

export function clearHistory(session: Session) {
  session.history = [];
}

export function getSession(platform: string, chatId: string): Session | undefined {
  return sessions.get(makeSessionKey(platform, chatId));
}

export function getAllSessions(): Session[] {
  return [...sessions.values()];
}

// Cleanup idle sessions (older than 2 hours)
export function cleanupIdleSessions(maxIdleMs = 2 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastActiveAt > maxIdleMs) {
      sessions.delete(key);
      log.debug({ key }, 'Idle session cleaned up');
    }
  }
}
