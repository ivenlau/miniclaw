import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Attachment, AttachmentType } from '../../chat/types.js';

const ReadFileParams = Type.Object({
  path: Type.String({ description: '文件绝对路径' }),
  startLine: Type.Optional(Type.Number({ description: '起始行号（从1开始）' })),
  lineCount: Type.Optional(Type.Number({ description: '读取行数' })),
});

export const readFileTool: AgentTool<typeof ReadFileParams> = {
  name: 'read_file',
  label: '读取文件',
  description: '读取指定文件的内容，支持指定行范围',
  parameters: ReadFileParams,
  async execute(_id, params) {
    const filePath = params.path;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(1, params.startLine ?? 1);
      const lineCount = params.lineCount ?? lines.length;
      const selected = lines.slice(startLine - 1, startLine - 1 + lineCount);
      const totalLines = lines.length;
      const showing = selected.length;
      const header = `${path.basename(filePath)}（共 ${totalLines} 行，显示第 ${startLine}-${startLine + showing - 1} 行）\n`;
      const numbered = selected
        .map((line, i) => `${String(startLine + i).padStart(4)} │ ${line}`)
        .join('\n');
      return { content: [{ type: 'text', text: header + numbered }], details: undefined };
    } catch (err: any) {
      if (err.code === 'ENOENT') throw new Error(`文件不存在: ${filePath}`);
      throw new Error(`读取失败: ${err.message}`);
    }
  },
};

const WriteFileParams = Type.Object({
  path: Type.String({ description: '文件绝对路径' }),
  content: Type.String({ description: '要写入的内容' }),
});

export const writeFileTool: AgentTool<typeof WriteFileParams> = {
  name: 'write_file',
  label: '写入文件',
  description: '创建或覆盖写入文件',
  parameters: WriteFileParams,
  async execute(_id, params) {
    try {
      await fs.mkdir(path.dirname(params.path), { recursive: true });
      await fs.writeFile(params.path, params.content, 'utf-8');
      const lines = params.content.split('\n').length;
      return {
        content: [{ type: 'text', text: `已写入 ${path.basename(params.path)}（${lines} 行，${params.content.length} 字符）\n路径: ${params.path}` }],
        details: undefined,
      };
    } catch (err: any) {
      throw new Error(`写入失败: ${err.message}`);
    }
  },
};

const CopyFileParams = Type.Object({
  source: Type.String({ description: '源文件绝对路径' }),
  destination: Type.String({ description: '目标文件绝对路径' }),
});

export const copyFileTool: AgentTool<typeof CopyFileParams> = {
  name: 'copy_file',
  label: '复制文件',
  description: '复制文件到目标位置',
  parameters: CopyFileParams,
  async execute(_id, params) {
    await fs.access(params.source);
    await fs.mkdir(path.dirname(params.destination), { recursive: true });
    await fs.copyFile(params.source, params.destination);
    return {
      content: [{ type: 'text', text: `已复制 ${path.basename(params.source)} → ${params.destination}` }],
      details: undefined,
    };
  },
};

const MoveFileParams = Type.Object({
  source: Type.String({ description: '源文件绝对路径' }),
  destination: Type.String({ description: '目标文件绝对路径' }),
});

export const moveFileTool: AgentTool<typeof MoveFileParams> = {
  name: 'move_file',
  label: '移动文件',
  description: '移动/重命名文件',
  parameters: MoveFileParams,
  async execute(_id, params) {
    await fs.access(params.source);
    await fs.mkdir(path.dirname(params.destination), { recursive: true });
    await fs.rename(params.source, params.destination);
    return {
      content: [{ type: 'text', text: `已移动 ${path.basename(params.source)} → ${params.destination}` }],
      details: undefined,
    };
  },
};

const DeleteFileParams = Type.Object({
  path: Type.String({ description: '要删除的文件绝对路径' }),
});

export const deleteFileTool: AgentTool<typeof DeleteFileParams> = {
  name: 'delete_file',
  label: '删除文件',
  description: '删除指定文件（仅允许删除 .miniclaw-files 目录内的文件）',
  parameters: DeleteFileParams,
  async execute(_id, params) {
    if (!params.path.includes('.miniclaw-files')) {
      throw new Error('出于安全考虑，只能删除 .miniclaw-files 目录内的文件');
    }
    await fs.unlink(params.path);
    return {
      content: [{ type: 'text', text: `已删除 ${path.basename(params.path)}` }],
      details: undefined,
    };
  },
};

// ---- send_file ----

const EXT_TO_TYPE: Record<string, AttachmentType> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
  '.bmp': 'image', '.webp': 'image', '.svg': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.amr': 'audio', '.ogg': 'audio',
  '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.mkv': 'video',
};

export interface SendFileToolContext {
  addPendingAttachment: (att: Attachment) => void;
}

const SendFileParams = Type.Object({
  path: Type.String({ description: '要发送的文件绝对路径' }),
});

export function createSendFileTool(ctx: SendFileToolContext): AgentTool<typeof SendFileParams> {
  return {
    name: 'send_file',
    label: '发送文件',
    description: '将指定文件作为附件发送给用户（图片、文档、音视频等）',
    parameters: SendFileParams,
    async execute(_id, params) {
      const filePath = params.path;
      if (!fsSync.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }
      const stat = fsSync.statSync(filePath);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error(`无效文件: ${filePath}`);
      }

      const ext = path.extname(filePath).toLowerCase();
      const type: AttachmentType = EXT_TO_TYPE[ext] ?? 'file';

      ctx.addPendingAttachment({
        type,
        localPath: filePath,
        fileName: path.basename(filePath),
      });

      return {
        content: [{ type: 'text', text: `已准备发送文件: ${path.basename(filePath)}` }],
        details: undefined,
      };
    },
  };
}
