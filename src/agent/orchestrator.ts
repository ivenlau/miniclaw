import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, Attachment, AttachmentType } from '../chat/types.js';
import type { ChatAdapter } from '../chat/types.js';
import type { TrackedResource } from '../session/types.js';
import { getOrCreateSession, addToHistory, addResource, getTurnIndex } from '../session/manager.js';
import { getPersona } from '../persona/manager.js';
import { getLLMProvider } from '../llm/registry.js';
import { classifyIntent, type Intent } from './intent-classifier.js';
import { executeDirectAction } from './action-executor.js';
import { generateResponse } from './responder.js';
import { extractMemory } from './memory-extractor.js';
import { routeCommand, isCommand } from '../commands/router.js';
import { resolveCommand } from './command-resolver.js';
import { resolveSkill } from './skill-resolver.js';
import { getSkill, loadWorkspaceSkills, listSkillMetas } from '../skills/registry.js';
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
    // Track downloaded attachments as resources
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

  // 4. Check if it's a command
  if (isCommand(msg.content)) {
    const reply = await routeCommand(msg.content, session, adapter);
    if (reply) {
      await sendReply(adapter, msg, reply);
    }
    return;
  }

  // 5. Load persona & LLM
  const persona = getPersona(msg.senderId, msg.chatId);
  const llm = getLLMProvider();

  // 5.5. Load workspace custom skills (before intent classification so classifier sees them)
  await loadWorkspaceSkills(session.workspace);

  // 6. Classify intent (context-aware)
  const intentResult = await classifyIntent(llm, msg.content, session.history, session.resources);
  log.info({ intent: intentResult.intent, hasResolvedContext: !!intentResult.resolvedContext }, 'Intent classified');

  // Use resolved context for downstream processing
  const effectiveMessage = intentResult.resolvedContext ?? msg.content;

  // 7. Handle by intent
  let reply: string;
  let replyAttachments: Attachment[] | undefined;

  switch (intentResult.intent) {
    case 'direct_action': {
      const actionResult = await executeDirectAction(
        llm,
        effectiveMessage,
        session.resources,
        session.history,
        session.workspace,
      );
      reply = actionResult.reply;
      replyAttachments = actionResult.resultFiles;
      break;
    }

    case 'skill_task': {
      const resolution = await resolveSkill(llm, effectiveMessage, session.history, session.workspace);
      if (resolution) {
        const skill = getSkill(resolution.skillName);
        if (skill) {
          const result = await skill.execute(resolution.params, { workspace: session.workspace, llm, cliTool: session.cliTool, sessionId: session.id });
          reply = result.reply;
          replyAttachments = result.attachments;
          break;
        }
      }
      // Fallback: skill resolution failed, use LLM conversation
      const coreMemory = getCoreMemory();
      const topicMemories = searchTopicMemories(msg.content);
      reply = await generateResponse({
        llm,
        persona,
        coreMemory,
        topicMemories,
        workspace: session.workspace,
        history: session.history,
        userMessage: effectiveMessage,
        resources: session.resources,
      });
      break;
    }

    case 'coding_task': {
      // Notify user that task is starting
      await sendReply(adapter, msg, `⚡ 正在处理，稍等片刻...`);
      reply = await handleCodingTask(effectiveMessage, msg, session, adapter, llm);
      break;
    }

    case 'settings': {
      const command = await resolveCommand(llm, effectiveMessage, session.history);
      reply = await routeCommand(command, session, adapter);
      break;
    }

    default: {
      // question or chitchat — try custom skills first, then LLM direct response
      const builtinSkillNames = new Set(['file-read', 'file-write', 'file-search', 'content-search', 'dir-list', 'sys-info']);
      const hasCustomSkills = listSkillMetas().some(s => !builtinSkillNames.has(s.name));

      if (hasCustomSkills) {
        const resolution = await resolveSkill(llm, effectiveMessage, session.history, session.workspace);
        if (resolution) {
          const skill = getSkill(resolution.skillName);
          if (skill && !builtinSkillNames.has(skill.name)) {
            log.info({ skillName: skill.name }, 'Custom skill matched from question/chitchat fallback');
            const result = await skill.execute(resolution.params, { workspace: session.workspace, llm, cliTool: session.cliTool, sessionId: session.id });
            reply = result.reply;
            replyAttachments = result.attachments;
            break;
          }
        }
      }

      const coreMemory = getCoreMemory();
      const topicMemories = searchTopicMemories(msg.content);

      reply = await generateResponse({
        llm,
        persona,
        coreMemory,
        topicMemories,
        workspace: session.workspace,
        history: session.history,
        userMessage: effectiveMessage,
        resources: session.resources,
      });
      break;
    }
  }

  // 8. Send reply
  await sendReply(adapter, msg, reply, replyAttachments);

  // 9. Update history
  addToHistory(session, { role: 'user', content: msg.content });
  addToHistory(session, { role: 'assistant', content: reply });

  // 10. Async memory extraction (fire-and-forget)
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
  userMessage: string,
  msg: IncomingMessage,
  session: any,
  adapter: ChatAdapter,
  llm: any,
): Promise<string> {
  log.debug({ promptLen: userMessage.length, prompt: userMessage.slice(0, 500) }, 'CLI task prompt');

  // Build context-enriched prompt for CLI
  const contextParts: string[] = [];

  // Inject resources
  if (session.resources?.length) {
    const resourceLines = session.resources.map((r: TrackedResource) => {
      const desc = r.description ? ` - ${r.description}` : '';
      return `- ${r.type}: ${r.fileName} (${r.localPath})${desc}`;
    });
    contextParts.push(`## 会话中的文件资源\n${resourceLines.join('\n')}`);
  }

  // Inject recent history
  if (session.history?.length) {
    const recent = session.history.slice(-6).map((m: any) =>
      `${m.role}: ${m.content.slice(0, 300)}`
    );
    contextParts.push(`## 最近对话\n${recent.join('\n')}`);
  }

  // Current task
  contextParts.push(`## 当前任务\n${userMessage}`);

  const cliPrompt = contextParts.join('\n\n')
    + '\n\n[系统提示] 如果你创建、修改或保存了文件，请在输出的最后列出所有相关文件的完整绝对路径。';

  try {
    const result = await runCLITask({
      tool: session.cliTool,
      prompt: cliPrompt,
      workspace: session.workspace,
      sessionId: session.id,
    });

    // Extract file paths from CLI output and send as attachments
    const outputFiles = extractFilePaths(result);
    if (outputFiles.length > 0) {
      log.info({ files: outputFiles.map((a: Attachment) => a.localPath) }, 'Output files detected');
      await sendReply(adapter, msg, '', outputFiles);
    }

    // Summarize output if needed
    if (result.length > 3000) {
      const summary = await llm.chat({
        messages: [
          { role: 'system', content: '简洁总结以下 CLI 工具的输出结果，保留关键信息：' },
          { role: 'user', content: result.slice(0, 8000) },
        ],
        maxTokens: 1000,
      });
      return `✅ 搞定了\n\n${summary.content}`;
    }

    return `✅ 搞定了\n\n${result}`;
  } catch (err: any) {
    log.error({ err }, 'CLI task failed');
    return `😥 出了点问题: ${err.message ?? err}`;
  }
}

// ---- File path extraction from CLI output ----

const EXT_TO_TYPE: Record<string, AttachmentType> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
  '.bmp': 'image', '.webp': 'image', '.svg': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.amr': 'audio', '.ogg': 'audio',
  '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.mkv': 'video',
};

function extractFilePaths(cliOutput: string): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  // Match absolute paths: Windows (C:\...) and Unix (/...)
  // Look for paths that end with a file extension
  const pathRegex = /(?:[A-Za-z]:[\\\/][^\s"'<>|*?]+\.[a-zA-Z0-9]{1,5}|\/[^\s"'<>|*?]+\.[a-zA-Z0-9]{1,5})/g;

  for (const match of cliOutput.matchAll(pathRegex)) {
    let filePath = match[0].replace(/[.,;:!?)}\]]+$/, ''); // trim trailing punctuation
    filePath = path.normalize(filePath);

    if (seen.has(filePath)) continue;
    seen.add(filePath);

    try {
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size === 0) continue;

      const ext = path.extname(filePath).toLowerCase();
      const type: AttachmentType = EXT_TO_TYPE[ext] ?? 'file';

      attachments.push({
        type,
        localPath: filePath,
        fileName: path.basename(filePath),
      });

      log.debug({ filePath, type, size: stat.size }, 'Extracted output file');
    } catch {
      // file doesn't exist or can't access — skip
    }
  }

  return attachments;
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
      // Both DingtalkAdapter and FeishuAdapter have downloadFile method
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

  // Update message content to include detailed file info for downstream use
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
