import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';
import { stopCLITask, hasActiveTask } from '../../cli/runner.js';

export async function handleStop(_args: string, session: Session, _adapter: ChatAdapter): Promise<string> {
  if (!hasActiveTask(session.id)) {
    return '当前没有运行中的任务';
  }

  const stopped = stopCLITask(session.id);
  return stopped ? '✅ 任务已中止' : '未能中止任务';
}
