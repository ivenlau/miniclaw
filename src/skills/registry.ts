import path from 'node:path';
import type { Skill, SkillMeta } from './types.js';
import { loadCustomSkills } from './md-loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skills:registry');

const skills = new Map<string, Skill>();
const loadedWorkspaces = new Set<string>();

export function registerSkill(skill: Skill): void {
  skills.set(skill.name, skill);
  log.debug({ name: skill.name }, 'Skill registered');
}

export function getSkill(name: string): Skill | undefined {
  return skills.get(name);
}

export function listSkillMetas(): SkillMeta[] {
  return Array.from(skills.values()).map(s => ({
    name: s.name,
    description: s.description,
  }));
}

export async function loadWorkspaceSkills(workspace: string): Promise<void> {
  const skillsDir = path.join(workspace, '.miniclaw', 'skills');
  if (loadedWorkspaces.has(skillsDir)) return;
  loadedWorkspaces.add(skillsDir);

  const customSkills = await loadCustomSkills(skillsDir);
  for (const skill of customSkills) {
    registerSkill(skill);
  }

  if (customSkills.length > 0) {
    log.info({ workspace, count: customSkills.length }, 'Workspace skills loaded');
  }
}

export async function initSkills(): Promise<void> {
  const modules = await Promise.all([
    import('./builtins/file-read.js'),
    import('./builtins/file-write.js'),
    import('./builtins/file-search.js'),
    import('./builtins/content-search.js'),
    import('./builtins/dir-list.js'),
    import('./builtins/sys-info.js'),
    import('./builtins/task-plan.js'),
  ]);

  for (const mod of modules) {
    registerSkill(mod.default);
  }

  log.info({ count: skills.size }, 'Skills initialized');
}
