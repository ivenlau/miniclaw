import type { Attachment } from '../chat/types.js';
import type { LLMProvider } from '../llm/types.js';

export interface SkillMeta {
  name: string;
  description: string;
}

export interface Skill extends SkillMeta {
  parameterHint: string;
  execute(params: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult>;
}

export interface SkillContext {
  workspace: string;
  llm?: LLMProvider;
  cliTool?: string;
  sessionId?: string;
}

export interface SkillResult {
  reply: string;
  attachments?: Attachment[];
}
