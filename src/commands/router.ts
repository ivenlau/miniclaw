import type { Session } from '../session/types.js';
import type { ChatAdapter } from '../chat/types.js';
import { handleWorkspace } from './handlers/workspace.js';
import { handlePersona } from './handlers/persona.js';
import { handleMemory } from './handlers/memory.js';
import { handleSchedule } from './handlers/schedule.js';
import { handleModel } from './handlers/model.js';
import { handleStatus } from './handlers/status.js';
import { handleStop } from './handlers/stop.js';
import { handleHelp } from './handlers/help.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('commands');

type CommandHandler = (args: string, session: Session, adapter: ChatAdapter) => Promise<string>;

const handlers: Record<string, CommandHandler> = {
  '/workspace': handleWorkspace,
  '/tool': handleTool,
  '/persona': handlePersona,
  '/memory': handleMemory,
  '/schedule': handleSchedule,
  '/model': handleModel,
  '/status': handleStatus,
  '/stop': handleStop,
  '/help': handleHelp,
};

export function isCommand(content: string): boolean {
  return content.trim().startsWith('/');
}

export async function routeCommand(
  content: string,
  session: Session,
  adapter: ChatAdapter,
): Promise<string> {
  const trimmed = content.trim();
  const spaceIndex = trimmed.indexOf(' ');
  const command = spaceIndex > 0 ? trimmed.slice(0, spaceIndex) : trimmed;
  const args = spaceIndex > 0 ? trimmed.slice(spaceIndex + 1).trim() : '';

  const handler = handlers[command.toLowerCase()];
  if (!handler) {
    return `未知命令: ${command}\n输入 /help 查看可用命令`;
  }

  log.info({ command, args }, 'Executing command');
  return handler(args, session, adapter);
}

async function handleTool(args: string, session: Session): Promise<string> {
  if (!args) {
    return `当前工具: ${session.cliTool}\n可用工具: claude-code, codex, opencode`;
  }

  const { listCLITools } = await import('../cli/registry.js');
  const tools = listCLITools();

  if (!tools.includes(args)) {
    return `未知工具: ${args}\n可用工具: ${tools.join(', ')}`;
  }

  session.cliTool = args;
  return `已切换到 ${args}`;
}
