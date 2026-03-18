import os from 'node:os';
import type { Skill } from '../types.js';

const skill: Skill = {
  name: 'sys-info',
  description: '查看系统信息（OS、CPU、内存等）',
  parameterHint: '无参数',

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
      `💻 系统信息`,
      ``,
      `  OS:       ${os.type()} ${os.release()} (${os.arch()})`,
      `  主机名:   ${os.hostname()}`,
      `  CPU:      ${cpuModel} (${cpus.length} 核)`,
      `  内存:     ${formatGB(usedMem)} / ${formatGB(totalMem)} (空闲 ${formatGB(freeMem)})`,
      `  运行时间: ${hours}h ${minutes}m`,
      `  Node.js:  ${process.version}`,
      `  工作目录: ${process.cwd()}`,
    ];

    return { reply: info.join('\n') };
  },
};

function formatGB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default skill;
