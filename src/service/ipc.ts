import net from 'node:net';
import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { createLogger } from '../utils/logger.js';
import { handleMessage } from '../agent/orchestrator.js';
import { LocalAdapter } from '../chat/adapters/local.js';

const log = createLogger('ipc');

// ── Protocol types ──

export interface IpcRequest {
  type: 'chat';
  content: string;
  requestId: string;
}

export interface IpcResponse {
  type: 'reply' | 'attachment' | 'done' | 'error';
  content?: string;
  fileName?: string;
  localPath?: string;
  message?: string;
  requestId: string;
}

// ── Server side (runs inside the service process) ──

export function startIpcServer(ipcPath: string): net.Server {
  // Clean up stale socket file on Unix
  if (process.platform !== 'win32' && fs.existsSync(ipcPath)) {
    fs.unlinkSync(ipcPath);
  }

  const server = net.createServer((socket) => {
    log.info('TUI client connected');

    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      // Process complete JSON lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.trim()) continue;

        try {
          const req: IpcRequest = JSON.parse(line);
          handleIpcRequest(req, socket);
        } catch (err) {
          log.error({ err }, 'Invalid IPC message');
          writeLine(socket, { type: 'error', message: 'Invalid message format', requestId: '' });
        }
      }
    });

    socket.on('close', () => {
      log.info('TUI client disconnected');
    });

    socket.on('error', (err) => {
      log.debug({ err }, 'IPC socket error');
    });
  });

  server.listen(ipcPath, () => {
    log.info({ path: ipcPath }, 'IPC server listening');
  });

  server.on('error', (err) => {
    log.error({ err }, 'IPC server error');
  });

  return server;
}

function writeLine(socket: net.Socket, data: IpcResponse): void {
  try {
    socket.write(JSON.stringify(data) + '\n');
  } catch {
    // socket may be closed
  }
}

async function handleIpcRequest(req: IpcRequest, socket: net.Socket) {
  if (req.type !== 'chat') {
    writeLine(socket, { type: 'error', message: `Unknown request type: ${req.type}`, requestId: req.requestId });
    return;
  }

  const adapter = new LocalAdapter((resp) => writeLine(socket, resp), req.requestId);

  try {
    // handleMessage expects IncomingMessage + ChatAdapter
    const incomingMsg = {
      platform: 'local',
      messageId: req.requestId,
      chatId: 'tui',
      chatType: 'private' as const,
      senderId: 'local-user',
      senderName: 'You',
      content: req.content,
    };

    await handleMessage(incomingMsg, adapter);
    writeLine(socket, { type: 'done', requestId: req.requestId });
  } catch (err: any) {
    writeLine(socket, { type: 'error', message: err.message ?? String(err), requestId: req.requestId });
  }
}

// ── Client side (used by TUI process) ──

export interface IpcClient {
  send(content: string): Promise<{ reply: string; attachments: string[] }>;
  close(): void;
}

export function connectIpc(ipcPath: string): IpcClient {
  const socket = net.createConnection(ipcPath);
  const pending = new Map<string, {
    resolve: (val: { reply: string; attachments: string[] }) => void;
    reject: (err: Error) => void;
    reply: string;
    attachments: string[];
  }>();

  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;

      try {
        const resp: IpcResponse = JSON.parse(line);
        const entry = pending.get(resp.requestId);
        if (!entry) continue;

        switch (resp.type) {
          case 'reply':
            if (resp.content) entry.reply += resp.content;
            break;
          case 'attachment':
            if (resp.localPath) entry.attachments.push(resp.localPath);
            break;
          case 'done':
            pending.delete(resp.requestId);
            entry.resolve({ reply: entry.reply, attachments: entry.attachments });
            break;
          case 'error':
            pending.delete(resp.requestId);
            entry.reject(new Error(resp.message ?? 'Unknown error'));
            break;
        }
      } catch {
        // ignore malformed
      }
    }
  });

  socket.on('error', (err) => {
    for (const entry of pending.values()) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }
    pending.clear();
  });

  return {
    send(content: string): Promise<{ reply: string; attachments: string[] }> {
      const requestId = nanoid(10);
      const req: IpcRequest = { type: 'chat', content, requestId };

      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, reply: '', attachments: [] });
        socket.write(JSON.stringify(req) + '\n');
      });
    },

    close() {
      for (const entry of pending.values()) {
        entry.reject(new Error('Connection closed'));
      }
      pending.clear();
      socket.destroy();
    },
  };
}
