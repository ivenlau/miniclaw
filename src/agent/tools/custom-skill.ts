import fs from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { llmComplete, extractText } from '../../llm/pi-ai-adapter.js';
import { getLLMModel, getLLMApiKey } from '../../llm/registry.js';
import { stripThink } from '../../utils/llm-parse.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:custom-skill');

interface Frontmatter {
  meta: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };
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

/**
 * Load custom skills from a workspace directory and return them as AgentTools.
 * Each subdirectory with a SKILL.md file becomes a tool.
 */
export async function loadCustomSkillTools(skillsDir: string): Promise<AgentTool[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return [];
  }

  const tools: AgentTool[] = [];

  for (const entry of entries) {
    const fullPath = path.join(skillsDir, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) continue;
    } catch { continue; }

    const skillFile = path.join(fullPath, 'SKILL.md');
    let content: string;
    try {
      content = await fs.readFile(skillFile, 'utf-8');
    } catch { continue; }

    const { meta, body } = parseFrontmatter(content);
    if (!body) continue;

    const name = meta.name ?? entry;
    const description = meta.description ?? `自定义技能: ${name}`;

    const CustomSkillParams = Type.Object({
      message: Type.String({ description: '用自然语言描述你的需求' }),
    });

    const skillDir = fullPath;
    const skillBody = body;

    const tool: AgentTool<typeof CustomSkillParams> = {
      name: `custom_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      label: name,
      description,
      parameters: CustomSkillParams,
      async execute(_id, params) {
        const instructions = await loadReferences(skillDir, skillBody);
        const model = getLLMModel();
        const apiKey = getLLMApiKey();
        const result = await llmComplete(model, {
          systemPrompt: instructions,
          messages: [{ role: 'user', content: params.message, timestamp: Date.now() }],
        }, { maxTokens: 4000, apiKey });
        return {
          content: [{ type: 'text', text: stripThink(extractText(result)) }],
          details: undefined,
        };
      },
    };

    tools.push(tool as AgentTool<any>);
    log.info({ name, dir: entry }, 'Custom skill tool loaded');
  }

  return tools;
}
