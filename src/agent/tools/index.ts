import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@mariozechner/pi-ai';
import type { Session } from '../../session/types.js';

// File operations
import { readFileTool, writeFileTool, copyFileTool, moveFileTool, deleteFileTool, createSendFileTool } from './file-ops.js';

// Search
import { searchFilesTool, searchContentTool } from './search.js';

// System
import { listDirectoryTool, systemInfoTool } from './system.js';

// Coding
import { createRunCLITool, createStopCLITool } from './coding.js';

// Settings
import {
  createSwitchWorkspaceTool,
  createSwitchModelTool,
  createSetPersonaTool,
  createManageMemoryTool,
  createManageScheduleTool,
  createShowStatusTool,
  showHelpTool,
  createSwitchCLIToolTool,
} from './settings.js';

// Custom skills
import { loadCustomSkillTools } from './custom-skill.js';
import { clearHistory } from '../../session/manager.js';

// Helper to cast typed tools to the untyped array form
const tool = (t: AgentTool<any>) => t as AgentTool<TSchema>;

/** Static tools that don't depend on session context */
const staticTools: AgentTool<TSchema>[] = [
  tool(readFileTool),
  tool(writeFileTool),
  tool(copyFileTool),
  tool(moveFileTool),
  tool(deleteFileTool),
  tool(searchFilesTool),
  tool(searchContentTool),
  tool(listDirectoryTool),
  tool(systemInfoTool),
  tool(showHelpTool),
];

/**
 * Build the full tool list for a session.
 * Some tools need session context (workspace, userId, etc.) so they are created per-session.
 */
export async function buildToolsForSession(session: Session): Promise<AgentTool<TSchema>[]> {
  const addPendingAttachment = (att: any) => { session.pendingAttachments.push(att); };

  const settingsCtx = {
    getSessionId: () => session.id,
    getWorkspace: () => session.workspace,
    getCLITool: () => session.cliTool,
    getUserId: () => session.userId,
    getChatId: () => session.chatId,
    getPlatform: () => session.platform,
    setWorkspace: (ws: string) => { session.workspace = ws; },
    setCLITool: (t: string) => { session.cliTool = t; },
    getHistoryLength: () => session.history.length,
    clearSessionHistory: () => { clearHistory(session); },
  };

  const codingCtx = {
    getSessionId: () => session.id,
    getWorkspace: () => session.workspace,
    getCLITool: () => session.cliTool,
    addPendingAttachment,
  };

  const sessionTools: AgentTool<TSchema>[] = [
    ...staticTools,
    tool(createSendFileTool({ addPendingAttachment })),
    tool(createRunCLITool(codingCtx)),
    tool(createStopCLITool(codingCtx)),
    tool(createSwitchWorkspaceTool(settingsCtx)),
    tool(createSwitchModelTool()),
    tool(createSetPersonaTool(settingsCtx)),
    tool(createManageMemoryTool(settingsCtx)),
    tool(createManageScheduleTool(settingsCtx)),
    tool(createShowStatusTool(settingsCtx)),
    tool(createSwitchCLIToolTool(settingsCtx)),
  ];

  // Load custom skills from workspace
  const pathMod = await import('node:path');
  const skillsDir = pathMod.join(session.workspace, '.miniclaw', 'skills');
  const customTools = await loadCustomSkillTools(skillsDir);
  sessionTools.push(...customTools.map(t => tool(t)));

  return sessionTools;
}
