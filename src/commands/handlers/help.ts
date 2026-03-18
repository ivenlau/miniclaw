import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';

export async function handleHelp(_args: string, _session: Session, _adapter: ChatAdapter): Promise<string> {
  return [
    '🤖 MiniClaw - 智能 AI Agent',
    '',
    '命令列表:',
    '  /workspace [path]           查看/切换工作目录',
    '  /tool <name>                切换 CLI 工具 (claude-code/codex/opencode)',
    '  /persona [show|set <名>]    查看/设置人设',
    '  /memory [show|search|clear] 记忆管理',
    '  /schedule "<时间>" "<任务>"  创建定时任务',
    '  /model <name>               切换 LLM 提供商',
    '  /status                     查看当前状态',
    '  /stop                       中止运行中的任务',
    '  /help                       显示此帮助',
    '',
    '直接发消息即可对话，编程任务会自动委派给 CLI 工具执行。',
  ].join('\n');
}
