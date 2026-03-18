import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';
import { getActiveProviderName } from '../../llm/registry.js';
import { getAllSessions } from '../../session/manager.js';
import { getAllTasks } from '../../scheduler/manager.js';
import { hasActiveTask } from '../../cli/runner.js';

export async function handleStatus(_args: string, session: Session, _adapter: ChatAdapter): Promise<string> {
  const sessions = getAllSessions();
  const tasks = getAllTasks();
  const cliRunning = hasActiveTask(session.id);

  return [
    '📊 MiniClaw 状态',
    `├─ LLM 提供商: ${getActiveProviderName()}`,
    `├─ 工作目录: ${session.workspace}`,
    `├─ CLI 工具: ${session.cliTool}`,
    `├─ CLI 任务: ${cliRunning ? '运行中' : '空闲'}`,
    `├─ 活跃会话: ${sessions.length}`,
    `├─ 定时任务: ${tasks.length}`,
    `└─ 会话历史: ${session.history.length} 条`,
  ].join('\n');
}
