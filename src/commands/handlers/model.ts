import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';
import { setActiveProvider, listProviders, getActiveProviderName } from '../../llm/registry.js';

export async function handleModel(args: string, _session: Session, _adapter: ChatAdapter): Promise<string> {
  if (!args) {
    const current = getActiveProviderName();
    const available = listProviders();
    return `当前模型: ${current}\n可用模型: ${available.join(', ')}`;
  }

  try {
    setActiveProvider(args);
    return `已切换到 ${args}`;
  } catch (err: any) {
    return err.message;
  }
}
