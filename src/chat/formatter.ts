import stripAnsi from 'strip-ansi';

const MAX_MESSAGE_LENGTH = 4000;

export function cleanOutput(raw: string): string {
  return stripAnsi(raw).trim();
}

export function splitMessage(text: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) {
      // Fall back to splitting at space
      splitAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitAt <= 0) {
      // Hard split
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

export function formatCodeBlock(code: string, lang = ''): string {
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

export function formatProgressMessage(output: string, elapsed: number): string {
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
  const lastLines = output.split('\n').slice(-5).join('\n');
  return `⏳ 任务运行中 (${timeStr})...\n\n最近输出:\n${formatCodeBlock(lastLines)}`;
}
