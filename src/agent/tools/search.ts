import fs from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.miniclaw-files']);

// ---- search_files ----

async function searchFilesRecursive(
  dir: string,
  pattern: RegExp,
  maxResults: number,
  results: string[],
): Promise<void> {
  if (results.length >= maxResults) return;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await searchFilesRecursive(path.join(dir, entry.name), pattern, maxResults, results);
      }
    } else if (pattern.test(entry.name)) {
      results.push(path.join(dir, entry.name));
    }
  }
}

const SearchFilesParams = Type.Object({
  pattern: Type.String({ description: '文件名模式（支持通配符如 *.ts）' }),
  directory: Type.Optional(Type.String({ description: '搜索目录绝对路径' })),
  maxResults: Type.Optional(Type.Number({ description: '最大结果数，默认20' })),
});

export const searchFilesTool: AgentTool<typeof SearchFilesParams> = {
  name: 'search_files',
  label: '搜索文件',
  description: '按文件名模式递归搜索文件',
  parameters: SearchFilesParams,
  async execute(_id, params) {
    const dir = params.directory ?? process.cwd();
    const maxResults = Math.min(params.maxResults ?? 20, 100);
    const rawPattern = params.pattern;
    const regexStr = rawPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const pattern = new RegExp(`^${regexStr}$`, 'i');

    const results: string[] = [];
    await searchFilesRecursive(dir, pattern, maxResults, results);

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `未找到匹配 "${rawPattern}" 的文件` }], details: undefined };
    }
    const text = `找到 ${results.length} 个匹配文件：\n` + results.join('\n');
    return { content: [{ type: 'text', text }], details: undefined };
  },
};

// ---- search_content ----

const TEXT_EXTS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.json', '.md', '.txt', '.yaml', '.yml',
  '.toml', '.html', '.css', '.scss', '.vue', '.py', '.go', '.rs', '.sh',
  '.env', '.sql', '.xml', '.csv',
]);

interface Match { file: string; line: number; text: string; }

async function grepDir(
  dir: string,
  query: string,
  filePattern: RegExp | null,
  maxResults: number,
  matches: Match[],
): Promise<void> {
  if (matches.length >= maxResults) return;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (matches.length >= maxResults) return;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) await grepDir(fullPath, query, filePattern, maxResults, matches);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTS.has(ext)) continue;
    if (filePattern && !filePattern.test(entry.name)) continue;
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxResults) break;
        if (lines[i].includes(query)) {
          matches.push({ file: fullPath, line: i + 1, text: lines[i].trim() });
        }
      }
    } catch { /* skip */ }
  }
}

const SearchContentParams = Type.Object({
  query: Type.String({ description: '搜索文本' }),
  directory: Type.Optional(Type.String({ description: '搜索目录绝对路径' })),
  filePattern: Type.Optional(Type.String({ description: '文件名过滤（如 *.ts）' })),
  maxResults: Type.Optional(Type.Number({ description: '最大结果数，默认20' })),
});

export const searchContentTool: AgentTool<typeof SearchContentParams> = {
  name: 'search_content',
  label: '搜索文本内容',
  description: '在文件内容中搜索文本（类似 grep）',
  parameters: SearchContentParams,
  async execute(_id, params) {
    const dir = params.directory ?? process.cwd();
    const maxResults = Math.min(params.maxResults ?? 20, 100);
    if (!params.query) throw new Error('请提供搜索关键词');

    let filePattern: RegExp | null = null;
    if (params.filePattern) {
      const regexStr = params.filePattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      filePattern = new RegExp(`^${regexStr}$`, 'i');
    }

    const matches: Match[] = [];
    await grepDir(dir, params.query, filePattern, maxResults, matches);

    if (matches.length === 0) {
      return { content: [{ type: 'text', text: `未找到包含 "${params.query}" 的内容` }], details: undefined };
    }

    const lines = matches.map(m => {
      const excerpt = m.text.length > 100 ? m.text.slice(0, 100) + '...' : m.text;
      return `${m.file}:${m.line}  ${excerpt}`;
    });
    return {
      content: [{ type: 'text', text: `找到 ${matches.length} 处匹配：\n` + lines.join('\n') }],
      details: undefined,
    };
  },
};
