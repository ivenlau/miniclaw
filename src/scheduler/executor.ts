import type { ScheduledTask } from './types.js';
import { runCLITask } from '../cli/runner.js';
import { getAdapter } from '../chat/registry.js';
import { eventBus } from '../utils/events.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scheduler:executor');

export async function executeTask(task: ScheduledTask) {
  log.info({ taskId: task.id, name: task.name, command: task.command }, 'Executing scheduled task');
  eventBus.emit('schedule:fired', { taskId: task.id });

  try {
    const result = await runCLITask({
      tool: 'claude-code',
      prompt: task.command,
      workspace: task.workspace ?? process.cwd(),
      sessionId: `schedule:${task.id}`,
    });

    // Send result to chat target if specified
    if (task.chatTarget) {
      await sendResult(task.chatTarget, `⏰ 定时任务「${task.name}」已完成\n\n${result}`);
    }

    log.info({ taskId: task.id }, 'Scheduled task completed');
  } catch (err: any) {
    log.error({ err, taskId: task.id }, 'Scheduled task failed');

    if (task.chatTarget) {
      await sendResult(task.chatTarget, `⏰ 定时任务「${task.name}」失败: ${err.message}`);
    }
  }
}

async function sendResult(chatTarget: string, content: string) {
  // chatTarget format: "platform:chatId"
  const [platform, chatId] = chatTarget.split(':');
  const adapter = getAdapter(platform);
  if (adapter) {
    await adapter.send({ chatId, content });
  }
}
