import type { Agent } from '@mariozechner/pi-agent-core';
import type { Message } from '@mariozechner/pi-ai';
import type { Attachment, AttachmentType } from '../chat/types.js';

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
  history: Message[];
  resources: TrackedResource[];
  activeCLIProcess: string | null;
  agent?: Agent;
  pendingAttachments: Attachment[];
  createdAt: number;
  lastActiveAt: number;
}
