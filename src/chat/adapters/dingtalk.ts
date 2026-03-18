import fs from 'node:fs';
import path from 'node:path';
import type { ChatAdapter, IncomingMessage, OutgoingMessage, Attachment, AttachmentType } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('chat:dingtalk');

type MessageHandler = (msg: IncomingMessage) => void;

// Map DingTalk msgtype to our AttachmentType
const MEDIA_TYPES: Record<string, AttachmentType> = {
  picture: 'image',
  file: 'file',
  audio: 'audio',
  video: 'video',
};

export class DingtalkAdapter implements ChatAdapter {
  readonly name = 'dingtalk';
  private handler: MessageHandler | null = null;
  private client: any = null;
  private clientId: string;
  private clientSecret: string;
  private webhooks = new Map<string, string>();
  // Store conversationId → openConversationId mapping for OpenAPI sends
  private openConversationIds = new Map<string, string>();

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private getAccessToken(): string {
    return this.client?.getConfig?.()?.access_token ?? '';
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
          const chatType = data.conversationType === '2' ? 'group' : 'private';

          // Save sessionWebhook for replying
          if (data.sessionWebhook) {
            this.webhooks.set(chatId, data.sessionWebhook);
          }

          // Save openConversationId if present (same as conversationId for stream mode)
          if (data.conversationId) {
            this.openConversationIds.set(chatId, data.conversationId);
          }

          // Parse attachments from media messages
          const msgtype = data.msgtype ?? 'text';
          const attachments = parseAttachments(data, msgtype);
          const content = extractTextContent(data, msgtype);

          const msg: IncomingMessage = {
            platform: 'dingtalk',
            messageId: data.msgId ?? '',
            chatId,
            chatType: chatType as 'group' | 'private',
            senderId: data.senderStaffId ?? data.senderId ?? '',
            senderName: data.senderNick ?? '',
            content,
            attachments: attachments.length > 0 ? attachments : undefined,
            rawEvent: data,
          };

          // Send typing indicator
          const typingContent = content || (attachments.length > 0 ? `[${attachments[0].type}]` : '...');
          this.sendMarkdown(chatId, '思考中', `> ${typingContent}\n\n⌨️ 正在思考...`).catch(() => {});

          // Fire and forget
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
    this.openConversationIds.clear();
    log.info('DingTalk adapter stopped');
  }

  async send(msg: OutgoingMessage) {
    // If there are file/image attachments to send, use OpenAPI
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        await this.sendAttachment(msg, att);
      }
      // Also send text content if present
      if (msg.content) {
        await this.sendMarkdown(msg.chatId, 'MiniClaw', msg.content);
      }
    } else {
      await this.sendMarkdown(msg.chatId, 'MiniClaw', msg.content);
    }
  }

  // ---- Download: get file from incoming message ----

  async downloadFile(downloadCode: string, destDir: string, fileName?: string): Promise<string> {
    const token = this.getAccessToken();
    if (!token) throw new Error('No access token available');

    // Step 1: get download URL
    const res = await fetch('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify({
        downloadCode,
        robotCode: this.clientId,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get download URL: ${res.status} ${text}`);
    }

    const { downloadUrl } = await res.json() as { downloadUrl: string };
    if (!downloadUrl) throw new Error('No downloadUrl in response');

    // Step 2: download the file
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) throw new Error(`Failed to download file: ${fileRes.status}`);

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    fs.mkdirSync(destDir, { recursive: true });

    // Determine file name with extension
    let finalName = fileName;
    if (!finalName) {
      // Try to get extension from Content-Type header
      const contentType = fileRes.headers.get('content-type') ?? '';
      const ext = MIME_TO_EXT[contentType] ?? guessExtFromUrl(downloadUrl) ?? '';
      finalName = `download_${Date.now()}${ext}`;
    } else if (!path.extname(finalName)) {
      // fileName exists but has no extension
      const contentType = fileRes.headers.get('content-type') ?? '';
      const ext = MIME_TO_EXT[contentType] ?? '';
      finalName = `${finalName}${ext}`;
    }

    const destFile = path.join(destDir, finalName);
    fs.writeFileSync(destFile, buffer);

    log.info({ destFile, size: buffer.length }, 'File downloaded');
    return destFile;
  }

  // ---- Upload: upload file to get mediaId ----

  async uploadMedia(filePath: string, type: 'image' | 'file' | 'voice' | 'video'): Promise<string> {
    const token = this.getAccessToken();
    if (!token) throw new Error('No access token available');

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const formData = new FormData();
    formData.append('type', type);
    formData.append('media', new Blob([fileBuffer]), fileName);

    const res = await fetch(`https://oapi.dingtalk.com/media/upload?access_token=${token}`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to upload media: ${res.status} ${text}`);
    }

    const data = await res.json() as { media_id?: string; errcode?: number; errmsg?: string };
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`Upload error: ${data.errmsg}`);
    }
    if (!data.media_id) throw new Error('No media_id in upload response');

    log.info({ mediaId: data.media_id, type, fileName }, 'Media uploaded');
    return data.media_id;
  }

  // ---- Send attachment via OpenAPI ----

  private async sendAttachment(msg: OutgoingMessage, att: Attachment) {
    const token = this.getAccessToken();
    if (!token) {
      log.warn('No access token, falling back to text description');
      await this.sendMarkdown(msg.chatId, 'MiniClaw', `📎 文件: ${att.fileName ?? att.localPath ?? '(unknown)'}`);
      return;
    }

    try {
      if (att.type === 'image' && att.url) {
        // Image with public URL — send directly
        await this.sendViaOpenAPI(msg, 'sampleImageMsg', { photoURL: att.url });
      } else if (att.type === 'image' && att.localPath) {
        // Image from local file — upload first
        const mediaId = await this.uploadMedia(att.localPath, 'image');
        // For images, we need a URL; use mediaId approach isn't supported for sampleImageMsg
        // Upload and use sampleImageMsg won't work, fallback to file
        await this.sendViaOpenAPI(msg, 'sampleFile', {
          mediaId,
          fileName: att.fileName ?? path.basename(att.localPath),
          fileType: path.extname(att.localPath).slice(1) || 'png',
        });
      } else if (att.localPath) {
        // File/audio/video — upload and send
        const uploadType = att.type === 'audio' ? 'voice' : att.type === 'video' ? 'video' : 'file';
        const mediaId = await this.uploadMedia(att.localPath, uploadType);

        if (att.type === 'audio') {
          await this.sendViaOpenAPI(msg, 'sampleAudio', { mediaId, duration: '0' });
        } else if (att.type === 'video') {
          await this.sendViaOpenAPI(msg, 'sampleVideo', { videoMediaId: mediaId, videoType: 'mp4', duration: '0' });
        } else {
          await this.sendViaOpenAPI(msg, 'sampleFile', {
            mediaId,
            fileName: att.fileName ?? path.basename(att.localPath),
            fileType: path.extname(att.localPath).slice(1) || 'file',
          });
        }
      } else if (att.mediaId) {
        // Already have mediaId
        await this.sendViaOpenAPI(msg, 'sampleFile', {
          mediaId: att.mediaId,
          fileName: att.fileName ?? 'file',
          fileType: 'file',
        });
      }
    } catch (err) {
      log.error({ err, att }, 'Failed to send attachment');
      await this.sendMarkdown(msg.chatId, 'MiniClaw', `❌ 文件发送失败: ${att.fileName ?? '(unknown)'}`);
    }
  }

  private async sendViaOpenAPI(
    msg: OutgoingMessage,
    msgKey: string,
    msgParam: Record<string, string>,
  ) {
    const token = this.getAccessToken();
    const chatType = msg.chatType ?? 'private';

    if (chatType === 'group') {
      const openConversationId = this.openConversationIds.get(msg.chatId) ?? msg.chatId;
      const res = await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': token,
        },
        body: JSON.stringify({
          robotCode: this.clientId,
          openConversationId,
          msgKey,
          msgParam: JSON.stringify(msgParam),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        log.error({ status: res.status, body: text }, 'OpenAPI group send failed');
      }
    } else {
      // Single chat: batchSend to sender
      const res = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': token,
        },
        body: JSON.stringify({
          robotCode: this.clientId,
          userIds: [msg.replyToMessageId ?? ''],  // need actual userId
          msgKey,
          msgParam: JSON.stringify(msgParam),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        log.error({ status: res.status, body: text }, 'OpenAPI oTo send failed');
      }
    }
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

// ---- Message parsing helpers ----

function parseAttachments(data: any, msgtype: string): Attachment[] {
  const attachments: Attachment[] = [];
  const type = MEDIA_TYPES[msgtype];

  if (type && data.downloadCode) {
    attachments.push({
      type,
      downloadCode: data.downloadCode,
      fileName: data.fileName,
    });
  }

  // richText may contain inline images
  if (msgtype === 'richText' && Array.isArray(data.content?.richText)) {
    for (const item of data.content.richText) {
      if (item.downloadCode) {
        attachments.push({
          type: 'image',
          downloadCode: item.downloadCode,
        });
      }
    }
  }

  return attachments;
}

function extractTextContent(data: any, msgtype: string): string {
  if (msgtype === 'text') {
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
  }

  if (msgtype === 'richText' && Array.isArray(data.content?.richText)) {
    const texts = data.content.richText
      .filter((item: any) => item.text)
      .map((item: any) => item.text);
    return texts.join('').trim();
  }

  // For media-only messages, return a description
  if (msgtype === 'picture') return '[图片]';
  if (msgtype === 'file') return `[文件] ${data.fileName ?? ''}`.trim();
  if (msgtype === 'audio') return '[语音]';
  if (msgtype === 'video') return '[视频]';

  return '';
}

// ---- MIME type to extension mapping ----

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/webp': '.webp',
  'audio/amr': '.amr',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

function guessExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    if (ext && ext.length <= 5) return ext;
  } catch {}
  return '';
}
