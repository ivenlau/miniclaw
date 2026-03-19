import type { LLMProvider, ChatMessage } from '../llm/types.js';
import { listSkillMetas, getSkill } from '../skills/registry.js';
import { createLogger } from '../utils/logger.js';
import { extractJSON } from '../utils/llm-parse.js';

const log = createLogger('agent:skill-resolver');

export interface SkillResolution {
  skillName: string;
  params: Record<string, unknown>;
}

function buildSkillList(): string {
  const skills = listSkillMetas();
  return skills.map(s => {
    const skill = getSkill(s.name);
    const hint = skill?.parameterHint ?? '无参数';
    return `- ${s.name}: ${s.description}\n  参数: ${hint}`;
  }).join('\n');
}

const RESOLVE_PROMPT = `你是一个技能解析器。根据用户消息，选择最合适的技能并提取参数。

## 可用技能
{SKILL_LIST}

## 规则
- 选择最匹配用户意图的技能
- 从用户消息中提取参数，提取不到就省略可选参数
- 文件路径如果是相对路径，直接使用原始路径
- 只输出 JSON，不要有其他内容

## 输出格式（严格 JSON）
{"skillName":"技能名","params":{"参数名":"值"}}`;

export async function resolveSkill(
  llm: LLMProvider,
  userMessage: string,
  history: ChatMessage[],
  workspace: string,
): Promise<SkillResolution | null> {
  const skillList = buildSkillList();
  const systemPrompt = RESOLVE_PROMPT.replace('{SKILL_LIST}', skillList);

  const recentHistory = history.slice(-4)
    .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  const userBlock = recentHistory
    ? `## 工作目录\n${workspace}\n\n## 最近对话\n${recentHistory}\n\n## 用户消息\n${userMessage}`
    : `## 工作目录\n${workspace}\n\n## 用户消息\n${userMessage}`;

  try {
    const result = await llm.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userBlock },
      ],
      temperature: 0,
      maxTokens: 300,
    });

    const raw = result.content.trim();
    const jsonStr = extractJSON(raw);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed.skillName === 'string' && parsed.params) {
        log.info({ userMessage: userMessage.slice(0, 80), skillName: parsed.skillName }, 'Skill resolved');
        return {
          skillName: parsed.skillName,
          params: parsed.params as Record<string, unknown>,
        };
      }
    }

    log.warn({ raw }, 'Failed to parse skill resolution JSON');
    return null;
  } catch (err) {
    log.error({ err }, 'Skill resolution failed');
    return null;
  }
}
