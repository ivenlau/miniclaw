import type { ChatAdapter, IncomingMessage, OutgoingMessage } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('chat:dingtalk');

type MessageHandler = (msg: IncomingMessage) => void;

export class DingtalkAdapter implements ChatAdapter {
  readonly name = 'dingtalk';
  private handler: MessageHandler | null = null;
  private client: any = null;
  private clientId: string;
  private clientSecret: string;
  // Store sessionWebhook per chatId for replies
  private webhooks = new Map<string, string>();

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async start() {
    try {
      const { DWClient, EventAck, TOPIC_ROBOT } = await import('dingtalk-stream-sdk-nodejs') as any;

      this.client = new DWClient({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      });

      this.client.registerCallbackListener(TOPIC_ROBOT, (event: any) => {
        // ACK immediately via websocket so DingTalk won't redeliver
        const messageId = event.headers?.messageId;
        if (messageId) {
          this.client.send(messageId, { status: EventAck.SUCCESS });
        }

        try {
          const data = JSON.parse(event.data);
          const chatId = data.conversationId ?? '';

          // Save sessionWebhook for replying
          if (data.sessionWebhook) {
            this.webhooks.set(chatId, data.sessionWebhook);
          }

          const msg: IncomingMessage = {
            platform: 'dingtalk',
            messageId: data.msgId ?? '',
            chatId,
            chatType: data.conversationType === '2' ? 'group' : 'private',
            senderId: data.senderStaffId ?? data.senderId ?? '',
            senderName: data.senderNick ?? '',
            content: extractTextContent(data),
            rawEvent: data,
          };
          // Send typing indicator immediately, quoting the user's message
          this.sendMarkdown(chatId, '思考中', `> ${msg.content}\n\n⌨️ 正在思考...`).catch(() => {});

          // Fire and forget — don't block the ACK
          Promise.resolve(this.handler?.(msg)).catch((err) => {
            log.error({ err }, 'Message handler error');
          });
        } catch (err) {
          log.error({ err }, 'Failed to parse DingTalk message');
        }
      });

      await this.client.connect();
      log.info('DingTalk Stream connected');
    } catch (err) {
      log.error({ err }, 'Failed to start DingTalk adapter');
      throw err;
    }
  }

  async stop() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.webhooks.clear();
    log.info('DingTalk adapter stopped');
  }

  async send(msg: OutgoingMessage) {
    await this.sendMarkdown(msg.chatId, 'MiniClaw', msg.content);
  }

  private async sendText(chatId: string, content: string) {
    await this.postWebhook(chatId, {
      msgtype: 'text',
      text: { content },
    });
  }

  private async sendMarkdown(chatId: string, title: string, text: string) {
    await this.postWebhook(chatId, {
      msgtype: 'markdown',
      markdown: { title, text },
    });
  }

  private async postWebhook(chatId: string, payload: Record<string, any>) {
    const webhook = this.webhooks.get(chatId);
    if (!webhook) {
      log.warn({ chatId }, 'No webhook found for chatId, cannot reply');
      return;
    }

    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        log.error({ status: res.status, body: text }, 'DingTalk webhook reply failed');
      } else {
        log.debug({ chatId }, 'Message sent via webhook');
      }
    } catch (err) {
      log.error({ err, chatId }, 'Failed to send DingTalk message');
    }
  }

  onMessage(handler: MessageHandler) {
    this.handler = handler;
  }
}

function extractTextContent(data: any): string {
  if (typeof data.text?.content === 'string') {
    return data.text.content.trim();
  }
  if (typeof data.content === 'string') {
    try {
      const parsed = JSON.parse(data.content);
      return parsed.content?.trim() ?? data.content.trim();
    } catch {
      return data.content.trim();
    }
  }
  return '';
}
