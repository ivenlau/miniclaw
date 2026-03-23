import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { WebAdapter } from '../../chat/adapters/web.js';
import { handleMessage } from '../../agent/orchestrator.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('web:chat');

export async function chatRoutes(app: FastifyInstance) {
  app.get('/api/chat/ws', { websocket: true }, (socket) => {
    const chatId = `web-${nanoid(8)}`;
    let busy = false;

    log.info({ chatId }, 'Web client connected');

    // Send connected message with chatId
    socket.send(JSON.stringify({ type: 'connected', chatId }));

    socket.on('message', async (raw: Buffer | string) => {
      let data: any;
      try {
        data = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON', requestId: '' }));
        return;
      }

      if (data.type !== 'chat' || !data.content) {
        socket.send(JSON.stringify({ type: 'error', message: 'Expected { type: "chat", content: "..." }', requestId: '' }));
        return;
      }

      if (busy) {
        socket.send(JSON.stringify({ type: 'error', message: '正在处理上一条消息，请稍候', requestId: '' }));
        return;
      }

      busy = true;
      const requestId = nanoid(10);

      const sendFn = (resp: any) => {
        try {
          socket.send(JSON.stringify(resp));
        } catch {
          // socket may be closed
        }
      };

      const adapter = new WebAdapter(sendFn, requestId);

      try {
        const incomingMsg = {
          platform: 'web',
          messageId: requestId,
          chatId: data.chatId ?? chatId,
          chatType: 'private' as const,
          senderId: 'web-user',
          senderName: 'Web User',
          content: data.content,
        };

        await handleMessage(incomingMsg, adapter);
        sendFn({ type: 'done', requestId });
      } catch (err: any) {
        sendFn({ type: 'error', message: err.message ?? String(err), requestId });
      } finally {
        busy = false;
      }
    });

    socket.on('close', () => {
      log.info({ chatId }, 'Web client disconnected');
    });
  });
}
