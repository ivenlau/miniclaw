import path from 'node:path';
import type { IncomingMessage, Attachment } from '../chat/types.js';
import type { ChatAdapter } from '../chat/types.js';
import { getOrCreateSession, addToHistory } from '../session/manager.js';
import { getPersona } from '../persona/manager.js';
import { getLLMProvider } from '../llm/registry.js';
import { classifyIntent, type Intent } from './intent-classifier.js';
import { generateResponse } from './responder.js';
import { extractMemory } from './memory-extractor.js';
import { routeCommand, isCommand } from '../commands/router.js';
import { runCLITask } from '../cli/runner.js';
import { getCoreMemory, searchTopicMemories } from '../memory/manager.js';
import { splitMessage } from '../chat/formatter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('orchestrator');

// Dedup: track recently processed message IDs (TTL 60s)
const recentMessages = new Map<string, number>();

function isDuplicate(messageId: string): boolean {
  if (!messageId) return false;
  const now = Date.now();
  // Clean old entries
  for (const [id, ts] of recentMessages) {
    if (now - ts > 60_000) recentMessages.delete(id);
  }
  if (recentMessages.has(messageId)) return true;
  recentMessages.set(messageId, now);
  return false;
}

export async function handleMessage(msg: IncomingMessage, adapter: ChatAdapter) {
  // Dedup
  if (isDuplicate(msg.messageId)) {
    log.debug({ messageId: msg.messageId }, 'Duplicate message, skipping');
    return;
  }

  const session = getOrCreateSession(msg.platform, msg.chatId, msg.senderId);

  log.info({
    platform: msg.platform,
    chatId: msg.chatId,
    sender: msg.senderName,
    content: msg.content.slice(0, 100),
    hasAttachments: !!msg.attachments?.length,
  }, 'Incoming message');

  // 0. Download attachments to workspace if present
  if (msg.attachments?.length) {
    await downloadAttachments(msg, session.workspace, adapter);
  }

  // 1. Check if it's a command
  if (isCommand(msg.content)) {
    const reply = await routeCommand(msg.content, session, adapter);
    if (reply) {
      await sendReply(adapter, msg, reply);
    }
    return;
  }

  // 2. Load persona
  const persona = getPersona(msg.senderId, msg.chatId);

  // 3. Get LLM provider
  const llm = getLLMProvider();

  // 4. Classify intent
  const intent = await classifyIntent(llm, msg.content);
  log.info({ intent }, 'Intent classified');

  // 5. Handle by intent
  let reply: string;

  if (intent === 'coding_task') {
    reply = await handleCodingTask(msg, session, adapter, llm);
  } else {
    // question or chitchat — LLM direct response
    const coreMemory = getCoreMemory();
    const topicMemories = searchTopicMemories(msg.content);

    reply = await generateResponse({
      llm,
      persona,
      coreMemory,
      topicMemories,
      workspace: session.workspace,
      history: session.history,
      userMessage: msg.content,
    });
  }

  // 6. Send reply
  await sendReply(adapter, msg, reply);

  // 7. Update history
  addToHistory(session, { role: 'user', content: msg.content });
  addToHistory(session, { role: 'assistant', content: reply });

  // 8. Async memory extraction (fire-and-forget)
  extractMemory(llm, msg.content, reply).then(async (extraction) => {
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

async function handleCodingTask(
  msg: IncomingMessage,
  session: any,
  adapter: ChatAdapter,
  llm: any,
): Promise<string> {
  // Notify user that task is starting
  await sendReply(adapter, msg, `🔧 收到编程任务，正在使用 ${session.cliTool} 处理...\n工作目录: ${session.workspace}`);

  try {
    const result = await runCLITask({
      tool: session.cliTool,
      prompt: msg.content,
      workspace: session.workspace,
      sessionId: session.id,
    });

    // Summarize output if needed
    if (result.length > 3000) {
      const summary = await llm.chat({
        messages: [
          { role: 'system', content: '简洁总结以下 CLI 工具的输出结果，保留关键信息：' },
          { role: 'user', content: result.slice(0, 8000) },
        ],
        maxTokens: 1000,
      });
      return `✅ 任务完成\n\n${summary.content}`;
    }

    return `✅ 任务完成\n\n${result}`;
  } catch (err: any) {
    log.error({ err }, 'CLI task failed');
    return `❌ 任务执行失败: ${err.message ?? err}`;
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
      // Attach files only with the last chunk
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
      // DingtalkAdapter has downloadFile method
      const dingtalk = adapter as any;
      if (typeof dingtalk.downloadFile === 'function') {
        const localPath = await dingtalk.downloadFile(
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

  // Update message content to include file info
  const fileDescriptions = msg.attachments
    .filter(a => a.localPath)
    .map(a => `📎 ${a.fileName ?? path.basename(a.localPath!)} → ${a.localPath}`)
    .join('\n');

  if (fileDescriptions) {
    msg.content = msg.content
      ? `${msg.content}\n\n收到的文件:\n${fileDescriptions}`
      : `收到的文件:\n${fileDescriptions}`;
  }
}
