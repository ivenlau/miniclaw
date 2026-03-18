import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';
import { getPersona, setPersona, getPreset } from '../../persona/manager.js';

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
    const presetName = parts[1];
    if (presetName) {
      const preset = getPreset(presetName);
      if (preset) {
        setPersona('user', session.userId, preset);
        return `已切换到预设人设: ${presetName}`;
      }
      return `未知预设: ${presetName}\n可用预设: professional, friendly, humorous`;
    }

    // Custom prompt
    const prompt = parts.slice(1).join(' ');
    if (prompt) {
      setPersona('user', session.userId, { systemPrompt: prompt });
      return `人设提示词已更新`;
    }
    return `用法: /persona set <预设名> 或 /persona set <自定义提示词>`;
  }

  return `用法: /persona [show|set <preset|prompt>]`;
}
