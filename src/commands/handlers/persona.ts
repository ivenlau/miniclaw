import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';
import { getPersona, setPersona, getPreset } from '../../persona/manager.js';
import { getLLMProvider } from '../../llm/registry.js';
import { stripThink } from '../../utils/llm-parse.js';

export async function handlePersona(args: string, session: Session, _adapter: ChatAdapter): Promise<string> {
  const parts = args.split(/\s+/);
  const subcommand = parts[0] ?? 'show';

  if (subcommand === 'show' || !args) {
    const persona = getPersona(session.userId, session.chatId);
    return [
      `人设信息:`,
      `- 名称: ${persona.name}`,
      `- 语气: ${persona.tone}`,
      `- 语言: ${persona.language}`,
      `- 提示词: ${persona.systemPrompt.slice(0, 100)}...`,
    ].join('\n');
  }

  if (subcommand === 'set') {
    const rest = parts.slice(1).join(' ');
    if (!rest) {
      return `用法: /persona set <预设名> 或 /persona set <自定义提示词>\n可用预设: professional, friendly, humorous`;
    }

    // Try preset first
    const preset = getPreset(rest);
    if (preset) {
      setPersona('user', session.userId, preset);
      return `已切换到预设人设: ${rest}`;
    }

    // If input is short (style description), use LLM to generate a full system prompt
    if (rest.length < 50) {
      const llm = getLLMProvider();
      const result = await llm.chat({
        messages: [
          { role: 'system', content: '你是一个人设设计师。根据用户给出的风格描述，生成一段完整的 AI 助手人设提示词（system prompt）。要求：1）以"你是 MiniClaw，"开头 2）详细描述说话风格、语气特点、性格特征 3）50-150字 4）只输出提示词本身，不要其他内容。' },
          { role: 'user', content: rest },
        ],
        temperature: 0.8,
        maxTokens: 300,
      });
      const generatedPrompt = stripThink(result.content);
      setPersona('user', session.userId, { systemPrompt: generatedPrompt });
      return `人设已更新:\n${generatedPrompt}`;
    }

    // Long input treated as a complete custom prompt
    setPersona('user', session.userId, { systemPrompt: rest });
    return `人设提示词已更新`;
  }

  return `用法: /persona [show|set <preset|prompt>]`;
}
