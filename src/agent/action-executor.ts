import fs from 'node:fs/promises';
import path from 'node:path';
import type { LLMProvider, ChatMessage } from '../llm/types.js';
import type { TrackedResource } from '../session/types.js';
import type { Attachment } from '../chat/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent:action');

interface ActionPlan {
  action: 'copy' | 'move' | 'save' | 'delete' | 'send';
  sourcePath: string;
  destPath?: string;
  reply: string;
}

const PLAN_PROMPT = `你是一个文件操作规划器。根据用户的请求、会话中的文件资源和对话历史，提取出要执行的文件操作。

## 支持的操作
- copy: 复制文件到目标位置
- move: 移动文件到目标位置
- save: 保存/另存文件到目标位置（本质同 copy）
- delete: 删除文件
- send: 将文件发送给用户（不做文件系统操作，只返回文件路径）

## 路径规则
- 所有路径必须是绝对路径
- "桌面"指 C:/Users/admin/Desktop
- "文档"指 C:/Users/admin/Documents
- "下载"指 C:/Users/admin/Downloads
- 如果用户没有指定文件名，保留原始文件名

## 输出格式（严格 JSON）
{"action":"<操作>","sourcePath":"<源文件绝对路径>","destPath":"<目标绝对路径，delete/send时可省略>","reply":"<回复给用户的友好消息>"}

只输出 JSON。`;

export async function executeDirectAction(
  llm: LLMProvider,
  userMessage: string,
  resources: TrackedResource[],
  history: ChatMessage[],
  workspace: string,
): Promise<{ reply: string; resultFiles?: Attachment[] }> {
  // Build context for LLM
  const resourceList = resources.length
    ? resources.map(r => `- [${r.type}] ${r.fileName} → ${r.localPath}${r.description ? ` (${r.description})` : ''}`).join('\n')
    : '（无文件资源）';

  const recentHistory = history.slice(-6)
    .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  const contextBlock = `## 会话文件资源
${resourceList}

## 工作目录
${workspace}

## 最近对话
${recentHistory}

## 用户请求
${userMessage}`;

  // Step 1: LLM extracts the action plan
  const result = await llm.chat({
    messages: [
      { role: 'system', content: PLAN_PROMPT },
      { role: 'user', content: contextBlock },
    ],
    temperature: 0,
    maxTokens: 300,
  });

  const raw = result.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.warn({ raw }, 'Failed to parse action plan');
    return { reply: '抱歉，我无法理解要执行的操作。请更具体地描述你想做什么。' };
  }

  let plan: ActionPlan;
  try {
    plan = JSON.parse(jsonMatch[0]);
  } catch {
    log.warn({ raw }, 'Invalid action plan JSON');
    return { reply: '抱歉，操作解析失败。请重新描述你想做什么。' };
  }

  log.info({ action: plan.action, source: plan.sourcePath, dest: plan.destPath }, 'Executing direct action');

  // Step 2: Validate & execute
  try {
    // Source file must exist (except for 'send' which we still validate)
    await fs.access(plan.sourcePath);
  } catch {
    return { reply: `找不到文件: ${plan.sourcePath}` };
  }

  try {
    switch (plan.action) {
      case 'copy':
      case 'save': {
        if (!plan.destPath) return { reply: '需要指定目标路径。' };
        await fs.mkdir(path.dirname(plan.destPath), { recursive: true });
        await fs.copyFile(plan.sourcePath, plan.destPath);
        log.info({ source: plan.sourcePath, dest: plan.destPath }, 'File copied');
        return { reply: plan.reply || `已将文件复制到 ${plan.destPath}` };
      }

      case 'move': {
        if (!plan.destPath) return { reply: '需要指定目标路径。' };
        await fs.mkdir(path.dirname(plan.destPath), { recursive: true });
        await fs.rename(plan.sourcePath, plan.destPath);
        log.info({ source: plan.sourcePath, dest: plan.destPath }, 'File moved');
        return { reply: plan.reply || `已将文件移动到 ${plan.destPath}` };
      }

      case 'delete': {
        // Safety: only allow deleting files inside .miniclaw-files/
        if (!plan.sourcePath.includes('.miniclaw-files')) {
          return { reply: '出于安全考虑，只能删除 .miniclaw-files 目录内的文件。' };
        }
        await fs.unlink(plan.sourcePath);
        log.info({ source: plan.sourcePath }, 'File deleted');
        return { reply: plan.reply || `已删除文件 ${path.basename(plan.sourcePath)}` };
      }

      case 'send': {
        const ext = path.extname(plan.sourcePath).toLowerCase();
        const EXT_TO_TYPE: Record<string, Attachment['type']> = {
          '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
          '.bmp': 'image', '.webp': 'image', '.svg': 'image',
          '.mp3': 'audio', '.wav': 'audio', '.amr': 'audio', '.ogg': 'audio',
          '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.mkv': 'video',
        };
        const type = EXT_TO_TYPE[ext] ?? 'file' as Attachment['type'];

        return {
          reply: plan.reply || `好的，这是你要的文件：`,
          resultFiles: [{
            type,
            localPath: plan.sourcePath,
            fileName: path.basename(plan.sourcePath),
          }],
        };
      }

      default:
        return { reply: `不支持的操作: ${plan.action}` };
    }
  } catch (err: any) {
    log.error({ err, plan }, 'Direct action failed');
    return { reply: `操作失败: ${err.message}` };
  }
}
