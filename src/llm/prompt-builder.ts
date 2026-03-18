import type { ChatMessage } from './types.js';
import type { Persona } from '../persona/types.js';

interface PromptContext {
  persona: Persona;
  coreMemory?: string;
  topicMemories?: string[];
  workspace?: string;
  availableCommands?: string[];
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const parts: string[] = [];

  // Persona
  parts.push(`# 人设\n${ctx.persona.systemPrompt}`);
  parts.push(`语气风格: ${ctx.persona.tone}`);
  if (ctx.persona.language !== 'auto') {
    parts.push(`主要语言: ${ctx.persona.language}`);
  }

  // Core memory
  if (ctx.coreMemory) {
    parts.push(`\n# 核心记忆\n${ctx.coreMemory}`);
  }

  // Topic memories
  if (ctx.topicMemories?.length) {
    parts.push(`\n# 相关记忆\n${ctx.topicMemories.join('\n---\n')}`);
  }

  // Workspace
  if (ctx.workspace) {
    parts.push(`\n# 当前工作目录\n${ctx.workspace}`);
  }

  // Commands
  if (ctx.availableCommands?.length) {
    parts.push(`\n# 可用命令\n${ctx.availableCommands.map(c => `- ${c}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

export function buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];
}
