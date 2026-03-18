import type { LLMProvider, ChatMessage } from '../llm/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent:command-resolver');

const RESOLVE_PROMPT = `你是一个命令解析器。根据用户的自然语言请求，返回对应的斜杠命令字符串。

## 可用命令

| 命令 | 参数 | 说明 |
|------|------|------|
| /workspace [path] | 可选：目录路径 | 无参数查看当前工作目录，有参数则切换 |
| /tool <name> | 工具名：claude-code, codex, opencode | 切换 CLI 工具 |
| /persona [show\|set <名>] | show 查看，set <名> 设置 | 人设管理 |
| /memory [show\|search <关键词>\|clear] | show 查看，search <词> 搜索，clear 清除 | 记忆管理 |
| /schedule "<时间>" "<任务>" | cron 表达式和任务描述 | 创建定时任务 |
| /model <name> | 提供商名：zhipuai, minimax, doubao, openai | 切换 LLM 提供商 |
| /status | 无 | 查看当前状态 |
| /stop | 无 | 中止运行中的任务 |
| /help | 无 | 显示帮助 |

## 规则
- 根据用户意图选择最匹配的命令
- 参数尽量从用户消息中提取，提取不到就省略可选参数
- 只输出 JSON，不要有其他内容

## 输出格式（严格 JSON）
{"command":"/model openai"}`;

export async function resolveCommand(
  llm: LLMProvider,
  userMessage: string,
  history: ChatMessage[],
): Promise<string> {
  const recentHistory = history.slice(-4)
    .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  const userBlock = recentHistory
    ? `## 最近对话\n${recentHistory}\n\n## 用户消息\n${userMessage}`
    : `## 用户消息\n${userMessage}`;

  try {
    const result = await llm.chat({
      messages: [
        { role: 'system', content: RESOLVE_PROMPT },
        { role: 'user', content: userBlock },
      ],
      temperature: 0,
      maxTokens: 200,
    });

    const raw = result.content.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.command === 'string' && parsed.command.startsWith('/')) {
        log.info({ userMessage: userMessage.slice(0, 80), command: parsed.command }, 'Resolved command');
        return parsed.command;
      }
    }

    log.warn({ raw }, 'Failed to parse command JSON, falling back to /help');
    return '/help';
  } catch (err) {
    log.error({ err }, 'Command resolution failed, falling back to /help');
    return '/help';
  }
}
