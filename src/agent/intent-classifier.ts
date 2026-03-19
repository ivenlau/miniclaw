import type { LLMProvider, ChatMessage } from '../llm/types.js';
import type { TrackedResource } from '../session/types.js';
import { createLogger } from '../utils/logger.js';
import { extractJSON } from '../utils/llm-parse.js';

const log = createLogger('agent:intent');

export type Intent = 'direct_action' | 'coding_task' | 'skill_task' | 'settings' | 'question' | 'chitchat';

export interface IntentResult {
  intent: Intent;
  resolvedContext?: string;  // 引用消解后的完整描述
}

function formatResources(resources: TrackedResource[]): string {
  if (!resources.length) return '（无）';
  return resources
    .map(r => {
      const desc = r.description ? ` - ${r.description}` : '';
      return `- [${r.type}] ${r.fileName} (${r.localPath})${desc}`;
    })
    .join('\n');
}

function formatHistory(history: ChatMessage[], maxTurns = 6): string {
  // Take the last N messages (up to maxTurns messages)
  const recent = history.slice(-maxTurns);
  if (!recent.length) return '（无）';
  return recent
    .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');
}

const CLASSIFY_PROMPT = `你是一个上下文感知的意图分类器。根据用户当前消息、对话历史和会话中的文件资源，完成以下两项任务：

## 任务一：意图分类
判断用户意图，返回以下之一：
- direct_action: 简单文件操作，如复制、移动、保存到指定位置、重命名、删除文件。这些操作用 Node.js fs 模块就能完成，不需要编写代码或启动 CLI 工具。注意：定时任务的增删改查不属于此类，属于 settings。
- skill_task: 读取文件内容、写入/创建文件、搜索文件、搜索文本内容、列出目录、查看系统信息等系统操作。这些比 direct_action（复制/移动/删除）更具探索性，但不需要编写代码或启动外部 CLI 工具。
- coding_task: 需要编写代码、运行命令、调试程序、处理图片（裁剪/缩放/格式转换等）、复杂文件操作等需要 CLI 工具的任务
- settings: 系统设置与管理操作，包括：查看/切换工作目录、切换 CLI 工具、切换模型/LLM 提供商、查看/设置人设、记忆管理（查看/搜索/清除记忆）、定时任务管理（查看/创建/删除/启用/禁用定时任务）、查看当前状态、中止运行中的任务、查看帮助信息
- question: 技术问题咨询、概念解释、方案建议等不需要直接操作的问题
- chitchat: 日常闲聊、打招呼、开玩笑等非技术内容

## 任务二：引用消解
如果用户消息中有模糊引用（如"那张图片"、"刚刚的文件"、"上面提到的"），请结合对话历史和文件资源列表，将其解析为具体内容。

## 输出格式（严格 JSON）
{"intent":"<类别>","resolvedContext":"<消解后的完整任务描述，如果没有模糊引用则与原消息相同>"}

只输出 JSON，不要有其他内容。`;

export async function classifyIntent(
  llm: LLMProvider,
  userMessage: string,
  history: ChatMessage[] = [],
  resources: TrackedResource[] = [],
): Promise<IntentResult> {
  const contextBlock = `## 会话文件资源
${formatResources(resources)}

## 最近对话
${formatHistory(history)}

## 当前用户消息
${userMessage}`;

  try {
    const result = await llm.chat({
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: contextBlock },
      ],
      temperature: 0,
      maxTokens: 300,
    });

    const raw = result.content.trim();

    // Try to parse JSON response (strip <think> blocks from reasoning models)
    const jsonStr = extractJSON(raw);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        const intent = parseIntent(parsed.intent);
        return {
          intent,
          resolvedContext: parsed.resolvedContext || userMessage,
        };
      } catch {
        log.warn({ raw }, 'Failed to parse intent JSON, falling back to text match');
      }
    }

    // Fallback: text-based matching
    return { intent: parseIntent(raw), resolvedContext: userMessage };
  } catch (err) {
    log.error({ err }, 'Intent classification failed, defaulting to question');
    return { intent: 'question', resolvedContext: userMessage };
  }
}

function parseIntent(raw: string): Intent {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('direct_action')) return 'direct_action';
  if (lower.includes('skill_task')) return 'skill_task';
  if (lower.includes('coding_task')) return 'coding_task';
  if (lower.includes('settings')) return 'settings';
  if (lower.includes('question')) return 'question';
  if (lower.includes('chitchat')) return 'chitchat';

  log.warn({ raw }, 'Unrecognized intent, defaulting to question');
  return 'question';
}
