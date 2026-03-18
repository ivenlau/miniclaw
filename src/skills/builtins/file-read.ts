import fs from 'node:fs/promises';
import path from 'node:path';
import type { Skill } from '../types.js';

const skill: Skill = {
  name: 'file-read',
  description: '读取文件内容（支持指定行范围）',
  parameterHint: '{"filePath":"文件路径","startLine?":"起始行号(从1开始)","lineCount?":"读取行数"}',

  async execute(params, ctx) {
    const filePath = path.resolve(ctx.workspace, String(params.filePath ?? ''));

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      const startLine = Math.max(1, Number(params.startLine) || 1);
      const lineCount = Number(params.lineCount) || lines.length;
      const selected = lines.slice(startLine - 1, startLine - 1 + lineCount);

      const totalLines = lines.length;
      const showing = selected.length;
      const header = `📄 ${path.basename(filePath)}（共 ${totalLines} 行，显示第 ${startLine}-${startLine + showing - 1} 行）\n`;

      const numbered = selected
        .map((line, i) => `${String(startLine + i).padStart(4)} │ ${line}`)
        .join('\n');

      return { reply: header + '```\n' + numbered + '\n```' };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { reply: `❌ 文件不存在: ${filePath}` };
      }
      return { reply: `❌ 读取失败: ${err.message}` };
    }
  },
};

export default skill;
