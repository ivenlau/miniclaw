import type { ChatAdapter, IncomingMessage, OutgoingMessage } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('chat:feishu');

type MessageHandler = (msg: IncomingMessage) => void;

export class FeishuAdapter implements ChatAdapter {
  readonly name = 'feishu';
  private handler: MessageHandler | null = null;
  private client: any = null;
  private appId: string;
  private appSecret: string;

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
  }

  async start() {
    try {
      const lark = await import('@larksuiteoapi/node-sdk');
      this.client = new lark.Client({
        appId: this.appId,
        appSecret: this.appSecret,
        appType: lark.AppType.SelfBuild,
      });

      const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: any) => {
          try {
            const event = data.event;
            if (!event?.message) return;

            const message = event.message;
            const content = extractContent(message);

            const msg: IncomingMessage = {
              platform: 'feishu',
              messageId: message.message_id ?? '',
              chatId: message.chat_id ?? '',
              chatType: message.chat_type === 'group' ? 'group' : 'private',
              senderId: event.sender?.sender_id?.user_id ?? '',
              senderName: event.sender?.sender_id?.user_id ?? '',
              content,
              rawEvent: data,
            };
            this.handler?.(msg);
          } catch (err) {
            log.error({ err }, 'Failed to parse Feishu message');
          }
        },
      });

      const wsClient = new lark.WSClient({
        appId: this.appId,
        appSecret: this.appSecret,
        eventDispatcher,
        loggerLevel: lark.LoggerLevel.WARN,
      });

      await wsClient.start();
      log.info('Feishu WebSocket connected');
    } catch (err) {
      log.error({ err }, 'Failed to start Feishu adapter');
      throw err;
    }
  }

  async stop() {
    this.client = null;
    log.info('Feishu adapter stopped');
  }

  async send(msg: OutgoingMessage) {
    if (!this.client) throw new Error('Feishu client not initialized');

    try {
      await this.client.im.message.create({
        data: {
          receive_id: msg.chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: msg.content }),
        },
        params: { receive_id_type: 'chat_id' },
      });
    } catch (err) {
      log.error({ err, chatId: msg.chatId }, 'Failed to send Feishu message');
      throw err;
    }
  }

  onMessage(handler: MessageHandler) {
    this.handler = handler;
  }
}

function extractContent(message: any): string {
  try {
    if (message.message_type === 'text') {
      const body = JSON.parse(message.content ?? '{}');
      return body.text?.trim() ?? '';
    }
  } catch {
    // ignore
  }
  return message.content ?? '';
}
