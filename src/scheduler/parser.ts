import type { LLMProvider } from '../llm/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scheduler:parser');

const PARSE_PROMPT = `你是一个 cron 表达式解析器。将用户的自然语言时间描述转换为标准 5 位 cron 表达式。

格式: 分 时 日 月 周
示例:
- "每天早上9点" → "0 9 * * *"
- "每小时" → "0 * * * *"
- "每周一早上10点" → "0 10 * * 1"
- "每5分钟" → "*/5 * * * *"
- "工作日下午6点" → "0 18 * * 1-5"

只返回 cron 表达式，不要返回其他内容。如果无法解析，返回 "INVALID"。`;

export async function parseNaturalLanguageToCron(llm: LLMProvider, description: string): Promise<string | null> {
  try {
    const result = await llm.chat({
      messages: [
        { role: 'system', content: PARSE_PROMPT },
        { role: 'user', content: description },
      ],
      temperature: 0,
      maxTokens: 30,
    });

    const cron = result.content.trim();
    if (cron === 'INVALID' || !isValidCron(cron)) {
      log.warn({ description, result: cron }, 'Failed to parse cron expression');
      return null;
    }

    return cron;
  } catch (err) {
    log.error({ err }, 'Cron parsing failed');
    return null;
  }
}

function isValidCron(expr: string): boolean {
  const parts = expr.split(/\s+/);
  return parts.length === 5;
}
