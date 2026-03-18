import type { LLMProvider } from '../llm/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent:memory-extractor');

interface ExtractionResult {
  shouldSave: boolean;
  target?: 'core' | 'topic';
  topicName?: string;
  content?: string;
}

const EXTRACT_PROMPT = `你是一个记忆提取器。分析下面的对话，判断是否有值得长期记忆的信息。

判断标准：
- 用户的偏好、习惯、常用工具
- 重要的技术决策或项目信息
- 反复提到的需求或约定
- 不值得记忆：一次性的问题、闲聊、临时调试信息

如果有值得记忆的信息，返回 JSON：
{
  "shouldSave": true,
  "target": "core" 或 "topic",
  "topicName": "主题名（仅 target=topic 时需要，如 project-web-app）",
  "content": "要保存的记忆内容（简洁的 markdown 格式）"
}

如果没有值得记忆的信息：
{ "shouldSave": false }

只返回 JSON，不要返回其他内容。`;

export async function extractMemory(
  llm: LLMProvider,
  userMessage: string,
  assistantReply: string,
): Promise<ExtractionResult> {
  try {
    const result = await llm.chat({
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: `用户: ${userMessage}\n助手: ${assistantReply}` },
      ],
      temperature: 0,
      maxTokens: 300,
    });

    const parsed = JSON.parse(result.content.trim());
    return parsed as ExtractionResult;
  } catch (err) {
    log.debug({ err }, 'Memory extraction failed or nothing to extract');
    return { shouldSave: false };
  }
}
