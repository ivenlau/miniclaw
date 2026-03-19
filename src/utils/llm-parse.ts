/** Strip <think>...</think> blocks from LLM responses (reasoning model artifacts). */
export function stripThink(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Strip <think> blocks, then extract the first JSON object from the remaining text.
 */
export function extractJSON(raw: string): string | null {
  const stripped = stripThink(raw);
  const match = stripped.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}
