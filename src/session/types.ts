import type { ChatMessage } from '../llm/types.js';
import type { AttachmentType } from '../chat/types.js';

export interface TrackedResource {
  type: AttachmentType;        // 'image' | 'file' | 'audio' | 'video'
  localPath: string;           // 本地绝对路径
  fileName: string;
  description?: string;        // LLM 描述（如"一张猫的照片"）
  addedAt: number;
  turnIndex: number;           // 第几轮对话时加入的
}

export interface Session {
  id: string;
  platform: string;
  chatId: string;
  userId: string;
  workspace: string;
  cliTool: string;
  history: ChatMessage[];
  resources: TrackedResource[];
  activeCLIProcess: string | null;   // process ID if a CLI task is running
  createdAt: number;
  lastActiveAt: number;
}
