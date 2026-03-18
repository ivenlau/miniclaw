import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';
import { createTask, getAllTasks, deleteTask, toggleTask } from '../../scheduler/manager.js';
import { parseNaturalLanguageToCron } from '../../scheduler/parser.js';
import { getLLMProvider } from '../../llm/registry.js';

export async function handleSchedule(args: string, session: Session, _adapter: ChatAdapter): Promise<string> {
  const parts = args.split(/\s+/);
  const subcommand = parts[0] ?? 'list';

  if (subcommand === 'list' || !args) {
    const tasks = getAllTasks();
    if (tasks.length === 0) return '没有定时任务';

    const lines = ['📅 定时任务列表:'];
    for (const task of tasks) {
      const status = task.enabled ? '✅' : '⏸️';
      const nextRun = task.nextRun
        ? new Date(task.nextRun * 1000).toLocaleString()
        : '未知';
      lines.push(`${status} [${task.id}] ${task.name} (${task.cronExpression}) → 下次: ${nextRun}`);
    }
    return lines.join('\n');
  }

  if (subcommand === 'delete') {
    const id = parts[1];
    if (!id) return '用法: /schedule delete <id>';
    return deleteTask(id) ? `已删除任务 ${id}` : `未找到任务 ${id}`;
  }

  if (subcommand === 'toggle') {
    const id = parts[1];
    const enabled = parts[2] !== 'off';
    if (!id) return '用法: /schedule toggle <id> [on|off]';
    toggleTask(id, enabled);
    return `任务 ${id} 已${enabled ? '启用' : '暂停'}`;
  }

  // Natural language: /schedule "每天9点" "运行测试"
  // Parse: first part is time description, rest is command
  const match = args.match(/^["'](.+?)["']\s+["'](.+?)["']$/);
  if (!match) {
    // Try splitting by first space after quotes
    const timeEnd = args.indexOf('" ');
    if (timeEnd === -1) {
      return '用法: /schedule "<时间描述>" "<任务命令>"\n示例: /schedule "每天早上9点" "运行测试"';
    }
  }

  const timeDesc = match?.[1] ?? parts.slice(0, Math.ceil(parts.length / 2)).join(' ');
  const command = match?.[2] ?? parts.slice(Math.ceil(parts.length / 2)).join(' ');

  const llm = getLLMProvider();
  const cron = await parseNaturalLanguageToCron(llm, timeDesc);

  if (!cron) {
    return `无法解析时间描述: "${timeDesc}"\n请使用标准描述，如 "每天早上9点"、"每小时"、"每周一10点" 等`;
  }

  const chatTarget = `${session.platform}:${session.chatId}`;
  const task = createTask(timeDesc, cron, command, {
    workspace: session.workspace,
    chatTarget,
  });

  return `✅ 定时任务已创建\nID: ${task.id}\nCron: ${task.cronExpression}\n命令: ${task.command}`;
}
