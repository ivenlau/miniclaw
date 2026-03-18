import fs from 'node:fs/promises';
import path from 'node:path';
import type { Skill } from '../types.js';

const skill: Skill = {
  name: 'file-write',
  description: '创建或写入文件',
  parameterHint: '{"filePath":"文件路径","content":"要写入的内容"}',

  async execute(params, ctx) {
    const filePath = path.resolve(ctx.workspace, String(params.filePath ?? ''));
    const content = String(params.content ?? '');

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      const lines = content.split('\n').length;
      return { reply: `✅ 已写入 ${path.basename(filePath)}（${lines} 行，${content.length} 字符）\n路径: ${filePath}` };
    } catch (err: any) {
      return { reply: `❌ 写入失败: ${err.message}` };
    }
  },
};

export default skill;
