import fsSync from 'node:fs';
import path from 'node:path';
import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Attachment, AttachmentType } from '../../chat/types.js';
import { runCLITask, stopCLITask, hasActiveTask } from '../../cli/runner.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:coding');

/** Session context injected at tool creation time */
export interface CodingToolContext {
  getSessionId: () => string;
  getWorkspace: () => string;
  getCLITool: () => string;
  addPendingAttachment: (att: Attachment) => void;
}

const EXT_TO_TYPE: Record<string, AttachmentType> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
  '.bmp': 'image', '.webp': 'image', '.svg': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.amr': 'audio', '.ogg': 'audio',
  '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.mkv': 'video',
};

/** Extract file paths from CLI output and queue as pending attachments */
function extractAndQueueFiles(cliOutput: string, addAttachment: (att: Attachment) => void): void {
  const seen = new Set<string>();
  const pathRegex = /(?:[A-Za-z]:[\\\/][^\s"'<>|*?]+\.[a-zA-Z0-9]{1,5}|\/[^\s"'<>|*?]+\.[a-zA-Z0-9]{1,5})/g;

  for (const match of cliOutput.matchAll(pathRegex)) {
    let filePath = match[0].replace(/[.,;:!?)}\]]+$/, '');
    filePath = path.normalize(filePath);
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    try {
      if (!fsSync.existsSync(filePath)) continue;
      const stat = fsSync.statSync(filePath);
      if (!stat.isFile() || stat.size === 0) continue;

      const ext = path.extname(filePath).toLowerCase();
      const type: AttachmentType = EXT_TO_TYPE[ext] ?? 'file';

      // Only auto-attach media files (images/audio/video), not arbitrary code files
      if (type === 'file') continue;

      addAttachment({
        type,
        localPath: filePath,
        fileName: path.basename(filePath),
      });

      log.debug({ filePath, type, size: stat.size }, 'CLI output file queued as attachment');
    } catch {
      // skip
    }
  }
}

const RunCLIParams = Type.Object({
  prompt: Type.String({ description: '要执行的编程任务描述，应包含完整上下文' }),
});

export function createRunCLITool(ctx: CodingToolContext): AgentTool<typeof RunCLIParams> {
  return {
    name: 'run_cli_task',
    label: '执行编程任务',
    description: '使用 CLI 工具（如 claude-code/codex）执行编程任务，包括写代码、运行命令、调试程序、处理图片等',
    parameters: RunCLIParams,
    async execute(_id, params) {
      const sessionId = ctx.getSessionId();
      const workspace = ctx.getWorkspace();
      const cliTool = ctx.getCLITool();

      log.info({ tool: cliTool, promptLen: params.prompt.length }, 'Running CLI task');

      const cliPrompt = params.prompt
        + '\n\n[系统提示] 如果你创建、修改或保存了文件，请在输出的最后列出所有相关文件的完整绝对路径。';

      try {
        const result = await runCLITask({
          tool: cliTool,
          prompt: cliPrompt,
          workspace,
          sessionId,
        });

        // Extract media files from CLI output and queue as attachments
        extractAndQueueFiles(result, ctx.addPendingAttachment);

        // Truncate very long output
        const output = result.length > 6000 ? result.slice(0, 6000) + '\n...(输出已截断)' : result;
        return { content: [{ type: 'text', text: `CLI 任务完成:\n${output}` }], details: undefined };
      } catch (err: any) {
        throw new Error(`CLI 任务失败: ${err.message}`);
      }
    },
  };
}

const StopCLIParams = Type.Object({});

export function createStopCLITool(ctx: CodingToolContext): AgentTool<typeof StopCLIParams> {
  return {
    name: 'stop_cli_task',
    label: '中止任务',
    description: '中止当前正在运行的 CLI 任务',
    parameters: StopCLIParams,
    async execute() {
      const sessionId = ctx.getSessionId();
      if (!hasActiveTask(sessionId)) {
        return { content: [{ type: 'text', text: '当前没有运行中的任务' }], details: undefined };
      }
      const stopped = stopCLITask(sessionId);
      return {
        content: [{ type: 'text', text: stopped ? '任务已中止' : '未能中止任务' }],
        details: undefined,
      };
    },
  };
}
