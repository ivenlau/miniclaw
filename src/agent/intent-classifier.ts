import type { LLMProvider } from '../llm/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent:intent');

export type Intent = 'coding_task' | 'question' | 'chitchat';

const CLASSIFY_PROMPT = `你是一个意图分类器。根据用户消息，判断其意图类别，只返回以下之一：
- coding_task: 需要操作文件系统的任务，包括但不限于：编写代码、修改文件、运行命令、调试程序、创建/复制/移动/删除/发送/保存文件、处理图片、文件格式转换等
- question: 技术问题咨询、概念解释、方案建议等不需要直接操作的问题
- chitchat: 日常闲聊、打招呼、开玩笑等非技术内容

只返回类别名称，不要返回其他内容。`;

export async function classifyIntent(llm: LLMProvider, userMessage: string): Promise<Intent> {
  try {
    const result = await llm.chat({
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      maxTokens: 20,
    });

    const raw = result.content.trim().toLowerCase();

    if (raw.includes('coding_task')) return 'coding_task';
    if (raw.includes('question')) return 'question';
    if (raw.includes('chitchat')) return 'chitchat';

    log.warn({ raw }, 'Unrecognized intent, defaulting to question');
    return 'question';
  } catch (err) {
    log.error({ err }, 'Intent classification failed, defaulting to question');
    return 'question';
  }
}
