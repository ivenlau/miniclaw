export interface IncomingMessage {
  platform: string;
  messageId: string;
  chatId: string;         // 群ID 或 单聊ID
  chatType: 'group' | 'private';
  senderId: string;
  senderName: string;
  content: string;
  rawEvent?: unknown;
}

export interface OutgoingMessage {
  chatId: string;
  content: string;
  replyToMessageId?: string;
}

export interface ChatAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutgoingMessage): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
}
