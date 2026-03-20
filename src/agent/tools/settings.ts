import fs from 'node:fs';
import path from 'node:path';
import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { setActiveProvider, listProviders, getActiveProviderName, getLLMModel, getLLMApiKey } from '../../llm/registry.js';
import { getPersona, setPersona, getPreset } from '../../persona/manager.js';
import { searchMemory, listMemoryTopics, getCoreMemory } from '../../memory/manager.js';
import { clearHistory, getAllSessions } from '../../session/manager.js';
import { createTask, getAllTasks, deleteTask, toggleTask } from '../../scheduler/manager.js';
import { parseNaturalLanguageToCron } from '../../scheduler/parser.js';
import { hasActiveTask } from '../../cli/runner.js';
import { listCLITools } from '../../cli/registry.js';
import { llmComplete, extractText } from '../../llm/pi-ai-adapter.js';
import { stripThink } from '../../utils/llm-parse.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:settings');

/** Session context injected at tool creation time */
export interface SettingsToolContext {
  getSessionId: () => string;
  getUserId: () => string;
  getChatId: () => string;
  getPlatform: () => string;
  getWorkspace: () => string;
  setWorkspace: (ws: string) => void;
  setCLITool: (tool: string) => void;
  getCLITool: () => string;
  getHistoryLength: () => number;
  clearSessionHistory: () => void;
}

// ---- switch_workspace ----

const SwitchWorkspaceParams = Type.Object({
  path: Type.Optional(Type.String({ description: '目标工作目录绝对路径，不提供则返回当前工作目录' })),
});

export function createSwitchWorkspaceTool(ctx: SettingsToolContext): AgentTool<typeof SwitchWorkspaceParams> {
  return {
    name: 'switch_workspace',
    label: '切换工作目录',
    description: '查看或切换当前工作目录',
    parameters: SwitchWorkspaceParams,
    async execute(_id, params) {
      if (!params.path) {
        return { content: [{ type: 'text', text: `当前工作目录: ${ctx.getWorkspace()}` }], details: undefined };
      }
      const target = params.path.startsWith('~')
        ? params.path.replace('~', process.env.HOME ?? process.env.USERPROFILE ?? '')
        : path.resolve(params.path);
      if (!fs.existsSync(target)) throw new Error(`目录不存在: ${target}`);
      if (!fs.statSync(target).isDirectory()) throw new Error(`不是一个目录: ${target}`);
      ctx.setWorkspace(target);
      return { content: [{ type: 'text', text: `工作目录已切换到: ${target}` }], details: undefined };
    },
  };
}

// ---- switch_model ----

const SwitchModelParams = Type.Object({
  provider: Type.Optional(Type.String({ description: 'LLM 提供商名称，不提供则返回当前模型信息' })),
});

export function createSwitchModelTool(): AgentTool<typeof SwitchModelParams> {
  return {
    name: 'switch_model',
    label: '切换模型',
    description: '查看或切换 LLM 提供商/模型',
    parameters: SwitchModelParams,
    async execute(_id, params) {
      if (!params.provider) {
        const current = getActiveProviderName();
        const available = listProviders();
        return { content: [{ type: 'text', text: `当前模型: ${current}\n可用模型: ${available.join(', ')}` }], details: undefined };
      }
      try {
        setActiveProvider(params.provider);
        return { content: [{ type: 'text', text: `已切换到 ${params.provider}` }], details: undefined };
      } catch (err: any) {
        throw new Error(err.message);
      }
    },
  };
}

// ---- set_persona ----

const SetPersonaParams = Type.Object({
  action: Type.Optional(Type.String({ description: '"show" 查看当前人设, "set" 设置人设' })),
  value: Type.Optional(Type.String({ description: '预设名称(professional/friendly/humorous)或自定义风格描述或完整提示词' })),
});

export function createSetPersonaTool(ctx: SettingsToolContext): AgentTool<typeof SetPersonaParams> {
  return {
    name: 'set_persona',
    label: '设置人设',
    description: '查看或设置 AI 助手的人设风格',
    parameters: SetPersonaParams,
    async execute(_id, params) {
      const action = params.action ?? 'show';
      if (action === 'show' || !params.value) {
        const persona = getPersona(ctx.getUserId(), ctx.getChatId());
        return {
          content: [{ type: 'text', text: `人设信息:\n- 名称: ${persona.name}\n- 语气: ${persona.tone}\n- 语言: ${persona.language}\n- 提示词: ${persona.systemPrompt.slice(0, 200)}...` }],
          details: undefined,
        };
      }
      // Try preset first
      const preset = getPreset(params.value);
      if (preset) {
        setPersona('user', ctx.getUserId(), preset);
        return { content: [{ type: 'text', text: `已切换到预设人设: ${params.value}` }], details: undefined };
      }
      // Short description → LLM generate prompt
      if (params.value.length < 50) {
        const model = getLLMModel();
        const apiKey = getLLMApiKey();
        const result = await llmComplete(model, {
          systemPrompt: '你是一个人设设计师。根据用户给出的风格描述，生成一段完整的 AI 助手人设提示词（system prompt）。要求：1）以"你是 MiniClaw，"开头 2）详细描述说话风格、语气特点、性格特征 3）50-150字 4）只输出提示词本身，不要其他内容。',
          messages: [{ role: 'user', content: params.value, timestamp: Date.now() }],
        }, { temperature: 0.8, maxTokens: 300, apiKey });
        const generatedPrompt = stripThink(extractText(result));
        setPersona('user', ctx.getUserId(), { systemPrompt: generatedPrompt });
        return { content: [{ type: 'text', text: `人设已更新:\n${generatedPrompt}` }], details: undefined };
      }
      // Long → direct prompt
      setPersona('user', ctx.getUserId(), { systemPrompt: params.value });
      return { content: [{ type: 'text', text: '人设提示词已更新' }], details: undefined };
    },
  };
}

// ---- manage_memory ----

const ManageMemoryParams = Type.Object({
  action: Type.String({ description: '"show" 查看记忆状态, "search" 搜索记忆, "clear" 清除会话历史' }),
  query: Type.Optional(Type.String({ description: '搜索关键词（action=search 时必须）' })),
});

export function createManageMemoryTool(ctx: SettingsToolContext): AgentTool<typeof ManageMemoryParams> {
  return {
    name: 'manage_memory',
    label: '管理记忆',
    description: '查看记忆状态、搜索记忆内容或清除会话历史',
    parameters: ManageMemoryParams,
    async execute(_id, params) {
      if (params.action === 'show') {
        const core = getCoreMemory();
        const topics = listMemoryTopics();
        const text = [
          '记忆系统状态:',
          `核心记忆: ${core ? `${core.split('\n').length} 行` : '空'}`,
          `主题文件: ${topics.length > 0 ? topics.join(', ') : '无'}`,
          `会话历史: ${ctx.getHistoryLength()} 条消息`,
        ].join('\n');
        return { content: [{ type: 'text', text }], details: undefined };
      }
      if (params.action === 'search') {
        if (!params.query) throw new Error('搜索需要提供关键词');
        const results = searchMemory(params.query);
        if (results.topics.length === 0) {
          return { content: [{ type: 'text', text: `搜索 "${params.query}" 无结果` }], details: undefined };
        }
        const lines = results.topics.map(t => `${t.name}:\n${t.content.slice(0, 200)}${t.content.length > 200 ? '...' : ''}`);
        return { content: [{ type: 'text', text: `搜索结果:\n${lines.join('\n\n')}` }], details: undefined };
      }
      if (params.action === 'clear') {
        ctx.clearSessionHistory();
        return { content: [{ type: 'text', text: '会话历史已清除' }], details: undefined };
      }
      throw new Error('action 必须是 show/search/clear');
    },
  };
}

// ---- manage_schedule ----

const ManageScheduleParams = Type.Object({
  action: Type.String({ description: '"list" 列出任务, "create" 创建任务, "delete" 删除任务, "toggle" 启用/禁用任务' }),
  timeDescription: Type.Optional(Type.String({ description: '自然语言时间描述（action=create 时必须，如"每天早上9点"）' })),
  command: Type.Optional(Type.String({ description: '任务命令（action=create 时必须）' })),
  taskId: Type.Optional(Type.String({ description: '任务ID（action=delete/toggle 时必须，delete 时可传 "all" 删除全部）' })),
  enabled: Type.Optional(Type.Boolean({ description: 'action=toggle 时使用，true=启用 false=禁用' })),
});

export function createManageScheduleTool(ctx: SettingsToolContext): AgentTool<typeof ManageScheduleParams> {
  return {
    name: 'manage_schedule',
    label: '管理定时任务',
    description: '列出、创建、删除或启用/禁用定时任务',
    parameters: ManageScheduleParams,
    async execute(_id, params) {
      if (params.action === 'list') {
        const tasks = getAllTasks();
        if (tasks.length === 0) return { content: [{ type: 'text', text: '没有定时任务' }], details: undefined };
        const lines = tasks.map(t => {
          const status = t.enabled ? '✅' : '⏸️';
          const nextRun = t.nextRun ? new Date(t.nextRun * 1000).toLocaleString() : '未知';
          return `${status} [${t.id}] ${t.name} (${t.cronExpression}) → 下次: ${nextRun}`;
        });
        return { content: [{ type: 'text', text: '定时任务列表:\n' + lines.join('\n') }], details: undefined };
      }

      if (params.action === 'create') {
        if (!params.timeDescription || !params.command) {
          throw new Error('创建任务需要 timeDescription 和 command');
        }
        const model = getLLMModel();
        const apiKey = getLLMApiKey();
        const cron = await parseNaturalLanguageToCron(model, apiKey, params.timeDescription);
        if (!cron) throw new Error(`无法解析时间描述: "${params.timeDescription}"`);
        const chatTarget = `${ctx.getPlatform()}:${ctx.getChatId()}`;
        const task = createTask(params.timeDescription, cron, params.command, {
          workspace: ctx.getWorkspace(),
          chatTarget,
        });
        return {
          content: [{ type: 'text', text: `定时任务已创建\nID: ${task.id}\nCron: ${task.cronExpression}\n命令: ${task.command}` }],
          details: undefined,
        };
      }

      if (params.action === 'delete') {
        if (!params.taskId) throw new Error('删除需要 taskId');
        if (params.taskId === 'all') {
          const tasks = getAllTasks();
          let count = 0;
          for (const t of tasks) { if (deleteTask(t.id)) count++; }
          return { content: [{ type: 'text', text: `已删除全部 ${count} 个定时任务` }], details: undefined };
        }
        const ok = deleteTask(params.taskId);
        return { content: [{ type: 'text', text: ok ? `已删除任务 ${params.taskId}` : `未找到任务 ${params.taskId}` }], details: undefined };
      }

      if (params.action === 'toggle') {
        if (!params.taskId) throw new Error('toggle 需要 taskId');
        const enabled = params.enabled ?? true;
        toggleTask(params.taskId, enabled);
        return { content: [{ type: 'text', text: `任务 ${params.taskId} 已${enabled ? '启用' : '暂停'}` }], details: undefined };
      }

      throw new Error('action 必须是 list/create/delete/toggle');
    },
  };
}

// ---- show_status ----

const ShowStatusParams = Type.Object({});

export function createShowStatusTool(ctx: SettingsToolContext): AgentTool<typeof ShowStatusParams> {
  return {
    name: 'show_status',
    label: '查看状态',
    description: '查看 MiniClaw 当前运行状态',
    parameters: ShowStatusParams,
    async execute() {
      const sessions = getAllSessions();
      const tasks = getAllTasks();
      const cliRunning = hasActiveTask(ctx.getSessionId());
      return {
        content: [{
          type: 'text',
          text: [
            'MiniClaw 状态',
            `├─ LLM 提供商: ${getActiveProviderName()}`,
            `├─ 工作目录: ${ctx.getWorkspace()}`,
            `├─ CLI 工具: ${ctx.getCLITool()}`,
            `├─ CLI 任务: ${cliRunning ? '运行中' : '空闲'}`,
            `├─ 活跃会话: ${sessions.length}`,
            `├─ 定时任务: ${tasks.length}`,
            `└─ 会话历史: ${ctx.getHistoryLength()} 条`,
          ].join('\n'),
        }],
        details: undefined,
      };
    },
  };
}

// ---- show_help ----

const ShowHelpParams = Type.Object({});

export const showHelpTool: AgentTool<typeof ShowHelpParams> = {
  name: 'show_help',
  label: '帮助',
  description: '显示可用的工具和使用说明',
  parameters: ShowHelpParams,
  async execute() {
    return {
      content: [{
        type: 'text',
        text: [
          'MiniClaw - 智能 AI Agent',
          '',
          '我可以帮你：',
          '  - 读取、写入、复制、移动、删除文件',
          '  - 搜索文件名和文件内容',
          '  - 列出目录内容、查看系统信息',
          '  - 执行编程任务（使用 CLI 工具）',
          '  - 切换工作目录、模型、人设',
          '  - 管理记忆和定时任务',
          '',
          '直接用自然语言告诉我你想做什么即可。',
        ].join('\n'),
      }],
      details: undefined,
    };
  },
};

// ---- switch_cli_tool ----

const SwitchCLIToolParams = Type.Object({
  tool: Type.Optional(Type.String({ description: 'CLI 工具名称（如 claude-code/codex/opencode）' })),
});

export function createSwitchCLIToolTool(ctx: SettingsToolContext): AgentTool<typeof SwitchCLIToolParams> {
  return {
    name: 'switch_cli_tool',
    label: '切换CLI工具',
    description: '查看或切换当前使用的 CLI 编程工具',
    parameters: SwitchCLIToolParams,
    async execute(_id, params) {
      if (!params.tool) {
        const tools = listCLITools();
        return { content: [{ type: 'text', text: `当前工具: ${ctx.getCLITool()}\n可用工具: ${tools.join(', ')}` }], details: undefined };
      }
      const tools = listCLITools();
      if (!tools.includes(params.tool)) {
        throw new Error(`未知工具: ${params.tool}\n可用工具: ${tools.join(', ')}`);
      }
      ctx.setCLITool(params.tool);
      return { content: [{ type: 'text', text: `已切换到 ${params.tool}` }], details: undefined };
    },
  };
}
