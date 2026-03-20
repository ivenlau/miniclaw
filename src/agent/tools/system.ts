import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';

// ---- list_directory ----

const ListDirParams = Type.Object({
  directory: Type.Optional(Type.String({ description: '目录绝对路径，默认工作目录' })),
  showHidden: Type.Optional(Type.Boolean({ description: '是否显示隐藏文件，默认false' })),
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const listDirectoryTool: AgentTool<typeof ListDirParams> = {
  name: 'list_directory',
  label: '列出目录',
  description: '列出目录内容（文件和子目录）',
  parameters: ListDirParams,
  async execute(_id, params) {
    const dir = params.directory ?? process.cwd();
    const showHidden = params.showHidden ?? false;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const filtered = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'));

      if (filtered.length === 0) {
        return { content: [{ type: 'text', text: `${dir} 是空目录` }], details: undefined };
      }

      const dirs: string[] = [];
      const files: string[] = [];

      for (const entry of filtered) {
        if (entry.isDirectory()) {
          dirs.push(`📁 ${entry.name}/`);
        } else {
          try {
            const stat = await fs.stat(path.join(dir, entry.name));
            files.push(`📄 ${entry.name}  (${formatSize(stat.size)})`);
          } catch {
            files.push(`📄 ${entry.name}`);
          }
        }
      }

      const lines = [...dirs.sort(), ...files.sort()];
      const header = `${dir}（${dirs.length} 目录，${files.length} 文件）\n`;
      return { content: [{ type: 'text', text: header + lines.join('\n') }], details: undefined };
    } catch (err: any) {
      if (err.code === 'ENOENT') throw new Error(`目录不存在: ${dir}`);
      throw new Error(`读取目录失败: ${err.message}`);
    }
  },
};

// ---- system_info ----

const SysInfoParams = Type.Object({});

function formatGB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export const systemInfoTool: AgentTool<typeof SysInfoParams> = {
  name: 'system_info',
  label: '系统信息',
  description: '查看系统信息（OS、CPU、内存等）',
  parameters: SysInfoParams,
  async execute() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model ?? 'Unknown';
    const uptimeSec = os.uptime();
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);

    const info = [
      `系统信息`,
      `  OS:       ${os.type()} ${os.release()} (${os.arch()})`,
      `  主机名:   ${os.hostname()}`,
      `  CPU:      ${cpuModel} (${cpus.length} 核)`,
      `  内存:     ${formatGB(usedMem)} / ${formatGB(totalMem)} (空闲 ${formatGB(freeMem)})`,
      `  运行时间: ${hours}h ${minutes}m`,
      `  Node.js:  ${process.version}`,
      `  工作目录: ${process.cwd()}`,
    ];

    return { content: [{ type: 'text', text: info.join('\n') }], details: undefined };
  },
};
