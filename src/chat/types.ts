export type AttachmentType = 'image' | 'file' | 'audio' | 'video';

export interface Attachment {
  type: AttachmentType;
  fileName?: string;
  downloadCode?: string;   // 钉钉 downloadCode，用于换取下载 URL
  localPath?: string;      // 下载到本地后的路径
  url?: string;            // 公网可访问 URL
  mediaId?: string;        // 钉钉 mediaId，用于发送
}

export interface IncomingMessage {
  platform: string;
  messageId: string;
  chatId: string;         // 群ID 或 单聊ID
  chatType: 'group' | 'private';
  senderId: string;
  senderName: string;
  content: string;
  attachments?: Attachment[];
  rawEvent?: unknown;
}

export interface OutgoingMessage {
  chatId: string;
  chatType?: 'group' | 'private';
  content: string;
  attachments?: Attachment[];
  replyToMessageId?: string;
}

export interface ChatAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutgoingMessage): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
}
