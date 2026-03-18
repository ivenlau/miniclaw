import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';
import { searchMemory, listMemoryTopics, getCoreMemory } from '../../memory/manager.js';
import { clearHistory } from '../../session/manager.js';

export async function handleMemory(args: string, session: Session, _adapter: ChatAdapter): Promise<string> {
  const parts = args.split(/\s+/);
  const subcommand = parts[0] ?? 'show';

  if (subcommand === 'show' || !args) {
    const core = getCoreMemory();
    const topics = listMemoryTopics();

    const lines = [`📝 记忆系统状态:`];
    lines.push(`\n核心记忆 (memory.md): ${core ? `${core.split('\n').length} 行` : '空'}`);
    lines.push(`主题文件: ${topics.length > 0 ? topics.join(', ') : '无'}`);
    lines.push(`会话历史: ${session.history.length} 条消息`);
    return lines.join('\n');
  }

  if (subcommand === 'search') {
    const query = parts.slice(1).join(' ');
    if (!query) return '用法: /memory search <关键词>';

    const results = searchMemory(query);
    const lines = [`🔍 搜索 "${query}" 的结果:`];

    if (results.topics.length === 0) {
      lines.push('没有找到相关记忆');
    } else {
      for (const topic of results.topics) {
        lines.push(`\n📄 ${topic.name}:`);
        lines.push(topic.content.slice(0, 200) + (topic.content.length > 200 ? '...' : ''));
      }
    }

    return lines.join('\n');
  }

  if (subcommand === 'clear') {
    clearHistory(session);
    return '会话历史已清除';
  }

  return '用法: /memory [show|search <关键词>|clear]';
}
