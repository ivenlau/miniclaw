import fs from 'node:fs/promises';
import path from 'node:path';
import type { Skill } from '../types.js';

const skill: Skill = {
  name: 'dir-list',
  description: '列出目录内容',
  parameterHint: '{"directory?":"目录路径,默认工作目录","showHidden?":"是否显示隐藏文件,默认false"}',

  async execute(params, ctx) {
    const dir = path.resolve(ctx.workspace, String(params.directory ?? ''));
    const showHidden = params.showHidden === true || params.showHidden === 'true';

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const filtered = showHidden
        ? entries
        : entries.filter(e => !e.name.startsWith('.'));

      if (filtered.length === 0) {
        return { reply: `📁 ${dir} 是空目录` };
      }

      const dirs: string[] = [];
      const files: string[] = [];

      for (const entry of filtered) {
        if (entry.isDirectory()) {
          dirs.push(`📁 ${entry.name}/`);
        } else {
          try {
            const stat = await fs.stat(path.join(dir, entry.name));
            const size = formatSize(stat.size);
            files.push(`📄 ${entry.name}  (${size})`);
          } catch {
            files.push(`📄 ${entry.name}`);
          }
        }
      }

      // Sort: directories first, then files
      const lines = [...dirs.sort(), ...files.sort()];
      const header = `📁 ${path.relative(ctx.workspace, dir) || '.'}（${dirs.length} 目录，${files.length} 文件）\n`;
      return { reply: header + lines.join('\n') };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { reply: `❌ 目录不存在: ${dir}` };
      }
      return { reply: `❌ 读取目录失败: ${err.message}` };
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default skill;
