import fs from 'node:fs/promises';
import path from 'node:path';
import type { Skill, SkillContext } from './types.js';
import { stripThink } from '../utils/llm-parse.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skills:md-loader');

interface Frontmatter {
  meta: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content.trim() };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) meta[key] = value;
  }

  return { meta, body: match[2].trim() };
}

async function loadReferences(skillDir: string, instructions: string): Promise<string> {
  // Find {{references/xxx}} patterns in instructions
  const refPattern = /\{\{(references\/[^}]+)\}\}/g;
  let result = instructions;

  for (const match of instructions.matchAll(refPattern)) {
    const refPath = path.join(skillDir, match[1]);
    try {
      const content = await fs.readFile(refPath, 'utf-8');
      result = result.replace(match[0], content);
    } catch {
      log.warn({ refPath }, 'Referenced file not found');
    }
  }

  return result;
}

async function loadSkillFromDir(skillDir: string): Promise<Skill | null> {
  const skillFile = path.join(skillDir, 'SKILL.md');
  let content: string;
  try {
    content = await fs.readFile(skillFile, 'utf-8');
  } catch {
    return null;
  }

  const { meta, body } = parseFrontmatter(content);
  const name = meta.name ?? path.basename(skillDir);
  const description = meta.description ?? '';

  if (!body) {
    log.warn({ name }, 'SKILL.md has no instructions body, skipping');
    return null;
  }

  return {
    name,
    description,
    parameterHint: '该技能由 AI 根据指令执行，用自然语言描述需求即可',
    async execute(params: Record<string, unknown>, ctx: SkillContext) {
      if (!ctx.llm) {
        return { reply: '❌ MD 技能需要 LLM 支持，但未提供 LLM provider' };
      }

      const instructions = await loadReferences(skillDir, body);
      const userMessage = (params.message as string) ?? (params.input as string) ?? JSON.stringify(params);

      const result = await ctx.llm.chat({
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: userMessage },
        ],
        maxTokens: 4000,
      });

      return { reply: stripThink(result.content) };
    },
  };
}

export async function loadCustomSkills(skillsDir: string): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return [];
  }

  const skills: Skill[] = [];

  for (const entry of entries) {
    const fullPath = path.join(skillsDir, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const skill = await loadSkillFromDir(fullPath);
    if (skill) {
      skills.push(skill);
      log.info({ name: skill.name, dir: entry }, 'Custom skill loaded');
    }
  }

  return skills;
}
