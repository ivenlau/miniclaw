import type { ChatAdapter, IncomingMessage, OutgoingMessage } from '../types.js';
import type { IpcResponse } from '../../service/ipc.js';

/**
 * Local adapter for TUI connections via IPC.
 * Created per-request by the IPC server — not a long-lived adapter.
 */
export class LocalAdapter implements ChatAdapter {
  name = 'local';
  private writeFn: (data: IpcResponse) => void;
  private requestId: string;
  private messageHandler?: (msg: IncomingMessage) => void;

  constructor(writeFn: (data: IpcResponse) => void, requestId: string) {
    this.writeFn = writeFn;
    this.requestId = requestId;
  }

  async start(): Promise<void> {
    // No-op: local adapter is per-request, not a persistent connection
  }

  async stop(): Promise<void> {
    // No-op
  }

  async send(msg: OutgoingMessage): Promise<void> {
    if (msg.content) {
      this.writeFn({ type: 'reply', content: msg.content, requestId: this.requestId });
    }
    if (msg.attachments) {
      for (const att of msg.attachments) {
        this.writeFn({
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
