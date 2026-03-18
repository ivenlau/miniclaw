import type { ChatMessage } from '../llm/types.js';

export interface Session {
  id: string;
  platform: string;
  chatId: string;
  userId: string;
  workspace: string;
  cliTool: string;
  history: ChatMessage[];
  activeCLIProcess: string | null;   // process ID if a CLI task is running
  createdAt: number;
  lastActiveAt: number;
}
