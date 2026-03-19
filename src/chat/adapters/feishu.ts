import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ChatAdapter, IncomingMessage, OutgoingMessage, Attachment, AttachmentType } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('chat:feishu');

type MessageHandler = (msg: IncomingMessage) => void;

// Map Feishu message_type to our AttachmentType
const MEDIA_TYPES: Record<string, AttachmentType> = {
  image: 'image',
  file: 'file',
  audio: 'audio',
  media: 'video',
};

export class FeishuAdapter implements ChatAdapter {
  readonly name = 'feishu';
  private handler: MessageHandler | null = null;
  private client: any = null;
  private wsClient: any = null;
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

      const eventDispatcher = new lark.EventDispatcher({
        loggerLevel: lark.LoggerLevel.DEBUG,
      } as any).register({
        'im.message.receive_v1': async (data: any) => {
          log.info('Feishu message event received');
          try {
            // Feishu SDK v2 schema: message/sender are at top level, not under data.event
            const message = data.message ?? data.event?.message;
            if (!message) {
              log.warn('No message in event data, skipping');
              return;
            }

            const sender = data.sender ?? data.event?.sender;
            const messageType = message.message_type ?? 'text';

            log.debug({
              messageType,
              messageId: message.message_id,
              chatType: message.chat_type,
            }, 'Raw Feishu message fields');

            const attachments = parseAttachments(message);
            const content = extractContent(message);

            const chatId = message.chat_id ?? '';

            const msg: IncomingMessage = {
              platform: 'feishu',
              messageId: message.message_id ?? '',
              chatId,
              chatType: message.chat_type === 'group' ? 'group' : 'private',
              senderId: sender?.sender_id?.user_id ?? sender?.sender_id?.open_id ?? '',
              senderName: sender?.sender_id?.user_id ?? '',
              content,
              attachments: attachments.length > 0 ? attachments : undefined,
              rawEvent: data,
            };

            // Send typing indicator by replying to the message
            this.replyText(message.message_id, `💭 思考中...`).catch(() => {});

            // Fire and forget
            Promise.resolve(this.handler?.(msg)).catch((err) => {
              log.error({ err }, 'Message handler error');
            });
          } catch (err) {
            log.error({ err }, 'Failed to parse Feishu message');
          }
        },
      });

      this.wsClient = new lark.WSClient({
        appId: this.appId,
        appSecret: this.appSecret,
        loggerLevel: lark.LoggerLevel.DEBUG,
      } as any);

      await this.wsClient.start({ eventDispatcher } as any);
      log.info('Feishu WebSocket connected');
    } catch (err) {
      log.error({ err }, 'Failed to start Feishu adapter');
      throw err;
    }
  }

  async stop() {
    this.client = null;
    this.wsClient = null;
    log.info('Feishu adapter stopped');
  }

  async send(msg: OutgoingMessage) {
    if (!this.client) throw new Error('Feishu client not initialized');

    // Send attachments first
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        await this.sendAttachment(msg, att);
      }
    }

    // Send text content
    if (msg.content) {
      if (msg.replyToMessageId) {
        await this.replyText(msg.replyToMessageId, msg.content);
      } else {
        await this.sendText(msg.chatId, msg.content);
      }
    }
  }

  // ---- Download: get file/image from incoming message ----

  async downloadFile(downloadCode: string, destDir: string, fileName?: string): Promise<string> {
    if (!this.client) throw new Error('Feishu client not initialized');

    // downloadCode is JSON: { messageId, fileKey, type }
    const { messageId, fileKey, type } = JSON.parse(downloadCode) as {
      messageId: string;
      fileKey: string;
      type: string;
    };

    let buffer: Buffer;

    // All message attachments (image/file/audio/video) use messageResource API
    const res = await this.client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    });

    buffer = await streamToBuffer(res);

    fs.mkdirSync(destDir, { recursive: true });

    // Determine file name
    let finalName = fileName;
    if (!finalName) {
      const ext = type === 'image' ? '.png' : '';
      finalName = `download_${Date.now()}${ext}`;
    }

    const destFile = path.join(destDir, finalName);
    fs.writeFileSync(destFile, buffer);

    log.info({ destFile, size: buffer.length }, 'File downloaded');
    return destFile;
  }

  // ---- Upload: upload file/image ----

  async uploadImage(filePath: string): Promise<string> {
    if (!this.client) throw new Error('Feishu client not initialized');

    const res = await this.client.im.image.create({
      data: {
        image_type: 'message',
        image: fs.createReadStream(filePath),
      },
    });

    const imageKey = res?.data?.image_key ?? res?.image_key;
    if (!imageKey) throw new Error('No image_key in upload response');

    log.info({ imageKey, fileName: path.basename(filePath) }, 'Image uploaded');
    return imageKey;
  }

  async uploadFile(filePath: string, fileType?: string): Promise<string> {
    if (!this.client) throw new Error('Feishu client not initialized');

    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Feishu file types: opus, mp4, pdf, doc, xls, ppt, stream
    const typeMap: Record<string, string> = {
      '.opus': 'opus', '.mp4': 'mp4', '.pdf': 'pdf',
      '.doc': 'doc', '.docx': 'doc', '.xls': 'xls', '.xlsx': 'xls',
      '.ppt': 'ppt', '.pptx': 'ppt',
    };
    const ft = fileType ?? typeMap[ext] ?? 'stream';

    const res = await this.client.im.file.create({
      data: {
        file_type: ft,
        file_name: fileName,
        file: fs.createReadStream(filePath),
      },
    });

    const fileKey = res?.data?.file_key ?? res?.file_key;
    if (!fileKey) throw new Error('No file_key in upload response');

    log.info({ fileKey, fileName }, 'File uploaded');
    return fileKey;
  }

  // ---- Send attachment ----

  private async sendAttachment(msg: OutgoingMessage, att: Attachment) {
    try {
      if (att.type === 'image' && att.localPath) {
        const imageKey = await this.uploadImage(att.localPath);
        await this.sendMessage(msg.chatId, msg.replyToMessageId, 'image', { image_key: imageKey });
      } else if (att.localPath) {
        const fileKey = await this.uploadFile(att.localPath);
        await this.sendMessage(msg.chatId, msg.replyToMessageId, 'file', { file_key: fileKey });
      }
    } catch (err) {
      log.error({ err, att }, 'Failed to send attachment');
      const fallback = `📎 文件发送失败: ${att.fileName ?? '(unknown)'}`;
      if (msg.replyToMessageId) {
        await this.replyText(msg.replyToMessageId, fallback);
      } else {
        await this.sendText(msg.chatId, fallback);
      }
    }
  }

  // ---- Low-level send helpers ----

  private async sendMessage(chatId: string, replyToMessageId: string | undefined, msgType: string, content: Record<string, string>) {
    if (replyToMessageId) {
      await this.client.im.message.reply({
        path: { message_id: replyToMessageId },
        data: {
          msg_type: msgType,
          content: JSON.stringify(content),
        },
      });
    } else {
      await this.client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: msgType,
          content: JSON.stringify(content),
        },
        params: { receive_id_type: 'chat_id' },
      });
    }
  }

  private async sendText(chatId: string, text: string) {
    try {
      await this.client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
        params: { receive_id_type: 'chat_id' },
      });
    } catch (err) {
      log.error({ err, chatId }, 'Failed to send Feishu text message');
    }
  }

  private async replyText(messageId: string, text: string) {
    try {
      await this.client.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    } catch (err) {
      log.error({ err, messageId }, 'Failed to reply Feishu message');
    }
  }

  onMessage(handler: MessageHandler) {
    this.handler = handler;
  }
}

// ---- Message parsing helpers ----

function parseAttachments(message: any): Attachment[] {
  const attachments: Attachment[] = [];
  const messageType = message.message_type;
  const messageId = message.message_id ?? '';

  try {
    const body = JSON.parse(message.content ?? '{}');

    if (messageType === 'image' && body.image_key) {
      attachments.push({
        type: 'image',
        downloadCode: JSON.stringify({ messageId, fileKey: body.image_key, type: 'image' }),
      });
    } else if (messageType === 'file' && body.file_key) {
      attachments.push({
        type: 'file',
        fileName: body.file_name,
        downloadCode: JSON.stringify({ messageId, fileKey: body.file_key, type: 'file' }),
      });
    } else if (messageType === 'audio' && body.file_key) {
      attachments.push({
        type: 'audio',
        downloadCode: JSON.stringify({ messageId, fileKey: body.file_key, type: 'audio' }),
      });
    } else if (messageType === 'media' && body.file_key) {
      attachments.push({
        type: 'video',
        fileName: body.file_name,
        downloadCode: JSON.stringify({ messageId, fileKey: body.file_key, type: 'media' }),
      });
    }
  } catch {
    // ignore parse errors
  }

  return attachments;
}

function extractContent(message: any): string {
  const messageType = message.message_type;

  try {
    const body = JSON.parse(message.content ?? '{}');

    if (messageType === 'text') {
      return (body.text ?? '').trim();
    }
  } catch {
    // ignore
  }

  // For media-only messages, return a description
  if (messageType === 'image') return '[图片]';
  if (messageType === 'file') return '[文件]';
  if (messageType === 'audio') return '[语音]';
  if (messageType === 'media') return '[视频]';

  return message.content ?? '';
}

// ---- Utility ----

async function streamToBuffer(stream: any): Promise<Buffer> {
  // The Lark SDK may return a Buffer, ReadableStream, or Node Readable
  if (Buffer.isBuffer(stream)) return stream;

  // Lark SDK download response: { writeFile, getReadableStream, headers }
  if (typeof stream?.getReadableStream === 'function') {
    const readable = await stream.getReadableStream();
    return streamToBuffer(readable);
  }

  if (stream instanceof Readable || typeof stream?.pipe === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // If it's an ArrayBuffer or has arrayBuffer method
  if (stream?.arrayBuffer) {
    return Buffer.from(await stream.arrayBuffer());
  }

  // If it has a data property (common Lark SDK response wrapper)
  if (stream?.data) {
    return streamToBuffer(stream.data);
  }

  throw new Error('Cannot convert response to buffer');
}
