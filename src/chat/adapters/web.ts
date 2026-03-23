import type { ChatAdapter, IncomingMessage, OutgoingMessage } from '../types.js';

export interface WebResponse {
  type: 'reply' | 'attachment' | 'done' | 'error';
  content?: string;
  fileName?: string;
  localPath?: string;
  message?: string;
  requestId: string;
}

/**
 * Web adapter for browser-based chat via WebSocket.
 * Created per-message, mirroring LocalAdapter's pattern.
 */
export class WebAdapter implements ChatAdapter {
  name = 'web';
  private sendFn: (data: WebResponse) => void;
  private requestId: string;
  private messageHandler?: (msg: IncomingMessage) => void;

  constructor(sendFn: (data: WebResponse) => void, requestId: string) {
    this.sendFn = sendFn;
    this.requestId = requestId;
  }

  async start(): Promise<void> {
    // No-op: per-request adapter
  }

  async stop(): Promise<void> {
    // No-op
  }

  async send(msg: OutgoingMessage): Promise<void> {
    if (msg.content) {
      this.sendFn({ type: 'reply', content: msg.content, requestId: this.requestId });
    }
    if (msg.attachments) {
      for (const att of msg.attachments) {
        this.sendFn({
          type: 'attachment',
          fileName: att.fileName,
          localPath: att.localPath,
          requestId: this.requestId,
        });
      }
    }
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }
}
