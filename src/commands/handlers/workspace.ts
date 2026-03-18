import type { Session } from '../../session/types.js';
import type { ChatAdapter } from '../../chat/types.js';
import fs from 'node:fs';
import path from 'node:path';

export async function handleWorkspace(args: string, session: Session, _adapter: ChatAdapter): Promise<string> {
  if (!args) {
    return `当前工作目录: ${session.workspace}`;
  }

  const target = args.startsWith('~')
    ? args.replace('~', process.env.HOME ?? process.env.USERPROFILE ?? '')
    : path.resolve(args);

  if (!fs.existsSync(target)) {
    return `目录不存在: ${target}`;
  }

  if (!fs.statSync(target).isDirectory()) {
    return `不是一个目录: ${target}`;
  }

  session.workspace = target;
  return `工作目录已切换到: ${target}`;
}
