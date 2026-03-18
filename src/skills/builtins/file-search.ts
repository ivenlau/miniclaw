import fs from 'node:fs/promises';
import path from 'node:path';
import type { Skill } from '../types.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.miniclaw-files']);

async function searchFiles(
  dir: string,
  pattern: RegExp,
  maxResults: number,
  results: string[],
): Promise<void> {
  if (results.length >= maxResults) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await searchFiles(path.join(dir, entry.name), pattern, maxResults, results);
      }
    } else if (pattern.test(entry.name)) {
      results.push(path.join(dir, entry.name));
    }
  }
}

const skill: Skill = {
  name: 'file-search',
  description: '按文件名模式递归搜索文件',
  parameterHint: '{"pattern":"文件名模式(支持通配符如*.ts)","directory?":"搜索目录","maxResults?":"最大结果数,默认20"}',

  async execute(params, ctx) {
    const dir = path.resolve(ctx.workspace, String(params.directory ?? ''));
    const maxResults = Math.min(Number(params.maxResults) || 20, 100);
    const rawPattern = String(params.pattern ?? '*');

    // Convert glob-like pattern to regex
    const regexStr = rawPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const pattern = new RegExp(`^${regexStr}$`, 'i');

    const results: string[] = [];
    await searchFiles(dir, pattern, maxResults, results);

    if (results.length === 0) {
      return { reply: `🔍 未找到匹配 "${rawPattern}" 的文件` };
    }

    const relative = results.map(f => path.relative(ctx.workspace, f).replace(/\\/g, '/'));
    const header = `🔍 找到 ${results.length} 个匹配 "${rawPattern}" 的文件${results.length >= maxResults ? '（已达上限）' : ''}：\n`;
    return { reply: header + relative.map(f => `  ${f}`).join('\n') };
  },
};

export default skill;
