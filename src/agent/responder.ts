import type { LLMProvider, ChatMessage } from '../llm/types.js';
import { buildSystemPrompt, buildMessages } from '../llm/prompt-builder.js';
import type { Persona } from '../persona/types.js';
import type { TrackedResource } from '../session/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent:responder');

interface RespondOptions {
  llm: LLMProvider;
  persona: Persona;
  coreMemory?: string;
  topicMemories?: string[];
  workspace?: string;
  history: ChatMessage[];
  userMessage: string;
  resources?: TrackedResource[];
}

export async function generateResponse(options: RespondOptions): Promise<string> {
  const systemPrompt = buildSystemPrompt({
    persona: options.persona,
    coreMemory: options.coreMemory,
    topicMemories: options.topicMemories,
    workspace: options.workspace,
    resources: options.resources,
    availableCommands: [
      '/workspace [path] - 查看/切换工作目录',
      '/tool <name> - 切换 CLI 工具',
      '/persona [set/show] - 查看/设置人设',
      '/memory [search/clear] - 查看/搜索/清除记忆',
      '/schedule <描述> <任务> - 创建定时任务',
      '/model <name> - 切换 LLM 提供商',
      '/status - 查看当前状态',
      '/stop - 中止运行中的任务',
      '/help - 帮助',
    ],
  });

  const messages = buildMessages(systemPrompt, options.history, options.userMessage);

  try {
    const result = await options.llm.chat({
      messages,
      temperature: 0.7,
    });
    return result.content;
  } catch (err) {
    log.error({ err }, 'Failed to generate response');
    return '抱歉，我遇到了一些问题，暂时无法回复。请稍后再试。';
  }
}
