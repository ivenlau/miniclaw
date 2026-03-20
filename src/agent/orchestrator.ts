import fs from 'node:fs';
import path from 'node:path';
import { Agent } from '@mariozechner/pi-agent-core';
import type { IncomingMessage, Attachment, AttachmentType } from '../chat/types.js';
import type { ChatAdapter } from '../chat/types.js';
import type { Session, TrackedResource } from '../session/types.js';
import { getOrCreateSession, addToHistory, addResource, getTurnIndex } from '../session/manager.js';
import { getPersona } from '../persona/manager.js';
import { getLLMModel, getLLMApiKey } from '../llm/registry.js';
import { buildSystemPrompt } from '../llm/prompt-builder.js';
import { buildToolsForSession } from './tools/index.js';
import { extractMemory } from './memory-extractor.js';
import { getCoreMemory, searchTopicMemories } from '../memory/manager.js';
import { splitMessage } from '../chat/formatter.js';
import { stripThink } from '../utils/llm-parse.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('orchestrator');

// Dedup: track recently processed message IDs (TTL 60s)
const recentMessages = new Map<string, number>();

function isDuplicate(messageId: string): boolean {
  if (!messageId) return false;
  const now = Date.now();
  for (const [id, ts] of recentMessages) {
    if (now - ts > 60_000) recentMessages.delete(id);
  }
  if (recentMessages.has(messageId)) return true;
  recentMessages.set(messageId, now);
  return false;
}

async function getOrCreateAgent(session: Session): Promise<Agent> {
  if (session.agent) {
    // Update system prompt in case persona/memory changed
    const persona = getPersona(session.userId, session.chatId);
    const coreMemory = getCoreMemory();
    const systemPrompt = buildSystemPrompt({
      persona,
      coreMemory: coreMemory ?? undefined,
      workspace: session.workspace,
      resources: session.resources,
    });
    session.agent.setSystemPrompt(systemPrompt);

    // Update model in case it was switched
    const model = getLLMModel();
    session.agent.setModel(model);

    // Rebuild tools (workspace may have changed, custom skills may have changed)
    const tools = await buildToolsForSession(session);
    session.agent.setTools(tools);

    return session.agent;
  }

  // Create new agent
  const persona = getPersona(session.userId, session.chatId);
  const coreMemory = getCoreMemory();
  const topicMemories = searchTopicMemories('');
  const model = getLLMModel();
  const apiKey = getLLMApiKey();
  const tools = await buildToolsForSession(session);

  const systemPrompt = buildSystemPrompt({
    persona,
    coreMemory: coreMemory ?? undefined,
    topicMemories: topicMemories.length > 0 ? topicMemories : undefined,
    workspace: session.workspace,
    resources: session.resources,
  });

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: 'off',
    },
    getApiKey: (provider: string) => {
      // Always return the current active provider's API key
      try {
        return getLLMApiKey(provider);
      } catch {
        return getLLMApiKey();
      }
    },
  });

  session.agent = agent;
  return agent;
}

/** Extract text reply from the Agent's last assistant message */
function extractAgentReply(agent: Agent): string {
  const messages = agent.state.messages;
  // Find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      const textParts = msg.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      if (textParts.length > 0) {
        return stripThink(textParts.join(''));
      }
    }
  }
  return '';
}

export async function handleMessage(msg: IncomingMessage, adapter: ChatAdapter) {
  // 1. Dedup
  if (isDuplicate(msg.messageId)) {
    log.debug({ messageId: msg.messageId }, 'Duplicate message, skipping');
    return;
  }

  // 2. Get session
  const session = getOrCreateSession(msg.platform, msg.chatId, msg.senderId);

  log.info({
    platform: msg.platform,
    chatId: msg.chatId,
    sender: msg.senderName,
    content: msg.content.slice(0, 100),
    hasAttachments: !!msg.attachments?.length,
  }, 'Incoming message');

  // 3. Download attachments → track to session.resources
  if (msg.attachments?.length) {
    await downloadAttachments(msg, session.workspace, adapter);
    const turnIndex = getTurnIndex(session);
    for (const att of msg.attachments) {
      if (att.localPath) {
        addResource(session, {
          type: att.type,
          localPath: att.localPath,
          fileName: att.fileName ?? path.basename(att.localPath),
          addedAt: Date.now(),
          turnIndex,
        });
      }
    }
  }

  // 4. Get or create Agent for this session
  const agent = await getOrCreateAgent(session);

  // 5. Run agent prompt — it auto-loops through tool calls
  try {
    await agent.prompt(msg.content);
  } catch (err: any) {
    log.error({ err }, 'Agent prompt failed');
    await sendReply(adapter, msg, `抱歉，我遇到了一些问题: ${err.message ?? err}`);
    return;
  }

  // 6. Extract final reply + pending attachments
  const reply = extractAgentReply(agent);
  const attachments = session.pendingAttachments.length > 0
    ? [...session.pendingAttachments]
    : undefined;
  session.pendingAttachments = [];

  if (reply || attachments?.length) {
    await sendReply(adapter, msg, reply, attachments);
  }

  // 7. Update session history (keep the pi-ai Messages in sync)
  session.history = [...agent.state.messages];

  // 8. Async memory extraction (fire-and-forget)
  if (reply) {
    extractMemory(msg.content, reply).then(async (extraction) => {
      if (extraction.shouldSave && extraction.content) {
        const { saveCoreMemory, saveTopicMemory } = await import('../memory/manager.js');
        if (extraction.target === 'core') {
          saveCoreMemory(extraction.content);
        } else if (extraction.topicName) {
          saveTopicMemory(extraction.topicName, extraction.content);
        }
      }
    }).catch((err) => {
      log.debug({ err }, 'Async memory extraction failed');
    });
  }
}

async function sendReply(
  adapter: ChatAdapter,
  msg: IncomingMessage,
  content: string,
  attachments?: Attachment[],
) {
  const chunks = splitMessage(content);
  for (let i = 0; i < chunks.length; i++) {
    await adapter.send({
      chatId: msg.chatId,
      chatType: msg.chatType,
      content: chunks[i],
      attachments: i === chunks.length - 1 ? attachments : undefined,
      replyToMessageId: msg.messageId,
    });
  }
}

async function downloadAttachments(
  msg: IncomingMessage,
  workspace: string,
  adapter: ChatAdapter,
) {
  if (!msg.attachments?.length) return;

  const downloadDir = path.join(workspace, '.miniclaw-files');

  for (const att of msg.attachments) {
    if (!att.downloadCode) continue;

    try {
      const adapterAny = adapter as any;
      if (typeof adapterAny.downloadFile === 'function') {
        const localPath = await adapterAny.downloadFile(
          att.downloadCode,
          downloadDir,
          att.fileName,
        );
        att.localPath = localPath;
        log.info({ type: att.type, fileName: att.fileName, localPath }, 'Attachment downloaded');
      }
    } catch (err) {
      log.error({ err, type: att.type, fileName: att.fileName }, 'Failed to download attachment');
    }
  }

  // Update message content to include detailed file info
  const TYPE_LABELS: Record<string, string> = {
    image: '图片文件', file: '文件', audio: '音频文件', video: '视频文件',
  };

  const downloadedFiles = msg.attachments.filter(a => a.localPath);

  if (downloadedFiles.length > 0) {
    const fileList = downloadedFiles
      .map(a => {
        const label = TYPE_LABELS[a.type] ?? a.type;
        const name = a.fileName ?? path.basename(a.localPath!);
        return `  - ${label}: ${name}\n    绝对路径: ${a.localPath}`;
      })
      .join('\n');

    const fileBlock = [
      '',
      '=== 用户通过聊天发送的附件（已自动下载到本地） ===',
      fileList,
      '注意：以上文件已保存在本地，请直接使用上面的绝对路径操作这些文件。',
      '===',
    ].join('\n');

    msg.content = msg.content
      ? `${msg.content}\n${fileBlock}`
      : `用户发送了附件。\n${fileBlock}`;
  }
}
