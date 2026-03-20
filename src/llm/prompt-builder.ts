import type { Persona } from '../persona/types.js';
import type { TrackedResource } from '../session/types.js';

interface PromptContext {
  persona: Persona;
  coreMemory?: string;
  topicMemories?: string[];
  workspace?: string;
  resources?: TrackedResource[];
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

  // Resources
  if (ctx.resources?.length) {
    const resourceLines = ctx.resources.map(r => {
      const desc = r.description ? ` - ${r.description}` : '';
      return `- [${r.type}] ${r.fileName} (${r.localPath})${desc}`;
    });
    parts.push(`\n# 会话中的文件资源\n${resourceLines.join('\n')}`);
  }

  return parts.join('\n\n');
}
