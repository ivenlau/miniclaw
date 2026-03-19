import type { ScheduledTask } from './types.js';
import type { IncomingMessage } from '../chat/types.js';
import { runCLITask } from '../cli/runner.js';
import { getAdapter } from '../chat/registry.js';
import { eventBus } from '../utils/events.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scheduler:executor');

export async function executeTask(task: ScheduledTask) {
  log.info({ taskId: task.id, name: task.name, command: task.command }, 'Executing scheduled task');
  eventBus.emit('schedule:fired', { taskId: task.id });

  if (task.chatTarget) {
    await executeViaChatFlow(task);
  } else {
    await executeViaCLI(task);
  }
}

/** Route through orchestrator — full intent classification, session history, proper tool selection */
async function executeViaChatFlow(task: ScheduledTask) {
  // chatTarget format: "platform:chatId" — split on first colon only (chatId may contain colons)
  const colonIdx = task.chatTarget!.indexOf(':');
  const platform = task.chatTarget!.slice(0, colonIdx);
  const chatId = task.chatTarget!.slice(colonIdx + 1);

  const adapter = getAdapter(platform);
  if (!adapter) {
    log.warn({ platform, taskId: task.id }, 'No adapter found for scheduled task');
    return;
  }

  try {
    // Notify user that the task is firing
    await adapter.send({ chatId, content: `⏰ 定时任务「${task.name}」触发` });

    // Build a synthetic IncomingMessage so orchestrator handles it end-to-end
    const syntheticMsg: IncomingMessage = {
      platform,
      messageId: `schedule:${task.id}:${Date.now()}`,
      chatId,
      chatType: 'group',
      senderId: 'scheduler',
      senderName: '定时任务',
      content: task.command,
    };

    // Dynamic import to avoid circular dependency (orchestrator imports scheduler indirectly)
    const { handleMessage } = await import('../agent/orchestrator.js');
    await handleMessage(syntheticMsg, adapter);

    log.info({ taskId: task.id }, 'Scheduled task completed via chat flow');
  } catch (err: any) {
    log.error({ err, taskId: task.id }, 'Scheduled task failed');
    await adapter.send({ chatId, content: `⏰ 定时任务「${task.name}」失败: ${err.message}` }).catch(() => {});
  }
}

/** Fallback: direct CLI execution for tasks without a chat target */
async function executeViaCLI(task: ScheduledTask) {
  try {
    const result = await runCLITask({
      tool: 'claude-code',
      prompt: task.command,
      workspace: task.workspace ?? process.cwd(),
      sessionId: `schedule:${task.id}`,
    });

    log.info({ taskId: task.id, resultLen: result.length }, 'Scheduled task completed via CLI');
  } catch (err: any) {
    log.error({ err, taskId: task.id }, 'Scheduled task failed (CLI)');
  }
}
