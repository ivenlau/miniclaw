import {
  TUI, ProcessTerminal, Editor, Markdown, Text, CancellableLoader,
  type EditorTheme, type MarkdownTheme,
} from '@mariozechner/pi-tui';
import { connectIpc, type IpcClient } from '../service/ipc.js';
import { isRunning } from '../service/daemon.js';
import { getIpcPath } from '../service/paths.js';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const italic = (s: string) => `\x1b[3m${s}\x1b[0m`;
const strikethrough = (s: string) => `\x1b[9m${s}\x1b[0m`;
const underline = (s: string) => `\x1b[4m${s}\x1b[0m`;
const identity = (s: string) => s;

export async function startTUI(home: string) {
  // 1. Check if service is running
  if (!isRunning(home)) {
    console.error('服务未启动，请先运行: miniclaw start');
    process.exit(1);
  }

  // 2. Connect IPC
  let ipc: IpcClient;
  try {
    ipc = connectIpc(getIpcPath());
  } catch (err: any) {
    console.error(`无法连接到服务: ${err.message}`);
    process.exit(1);
  }

  // 3. Init TUI
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const editorTheme: EditorTheme = {
    borderColor: cyan,
    selectList: {
      selectedPrefix: bold,
      selectedText: bold,
      description: dim,
      scrollInfo: dim,
      noMatch: dim,
    },
  };

  const markdownTheme: MarkdownTheme = {
    heading: bold,
    link: cyan,
    linkUrl: dim,
    code: cyan,
    codeBlock: identity,
    codeBlockBorder: dim,
    quote: dim,
    quoteBorder: dim,
    hr: dim,
    listBullet: dim,
    bold,
    italic,
    strikethrough,
    underline,
  };

  // 4. Welcome
  tui.addChild(new Text(bold('MiniClaw TUI') + dim(' — 输入消息开始对话，/quit 退出\n')));

  // 5. Editor
  const editor = new Editor(tui, editorTheme);
  tui.addChild(editor);
  tui.setFocus(editor);

  // 6. Submit handler
  editor.onSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed === '/quit') {
      tui.stop();
      ipc.close();
      process.exit(0);
    }

    const children = tui.children;

    // Show user message
    const userMsg = new Markdown(`**You:** ${text}`, 1, 0, markdownTheme);
    children.splice(children.length - 1, 0, userMsg);

    // Show loader
    const loader = new CancellableLoader(tui, cyan, dim, '思考中...');
    children.splice(children.length - 1, 0, loader);
    loader.start();
    editor.disableSubmit = true;
    tui.requestRender();

    try {
      const { reply, attachments } = await ipc.send(trimmed);

      loader.stop();
      tui.removeChild(loader);

      if (reply) {
        const botMsg = new Markdown(`**Bot:** ${reply}`, 1, 0, markdownTheme);
        const c = tui.children;
        c.splice(c.length - 1, 0, botMsg);
      }

      if (attachments.length > 0) {
        const attText = new Text(dim(`  附件: ${attachments.join(', ')}`));
        const c = tui.children;
        c.splice(c.length - 1, 0, attText);
      }
    } catch (err: any) {
      loader.stop();
      tui.removeChild(loader);
      const errMsg = new Text(red(`错误: ${err.message}`));
      const c = tui.children;
      c.splice(c.length - 1, 0, errMsg);
    }

    editor.disableSubmit = false;
    tui.requestRender();
  };

  // 7. Start
  tui.start();
}
