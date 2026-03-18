import type { Persona, PersonaOverride } from './types.js';
import { DEFAULT_PERSONA, PRESET_PERSONAS } from './defaults.js';
import { getDb } from '../utils/db.js';
import { getConfig } from '../config/loader.js';
import { nanoid } from 'nanoid';
import { createLogger } from '../utils/logger.js';

const log = createLogger('persona');

export function getPersona(userId?: string, chatId?: string): Persona {
  // Priority: user > group > config default > built-in default
  if (userId) {
    const userPersona = getOverride('user', userId);
    if (userPersona) return toPersona(userPersona);
  }

  if (chatId) {
    const groupPersona = getOverride('group', chatId);
    if (groupPersona) return toPersona(groupPersona);
  }

  const globalOverride = getOverride('global');
  if (globalOverride) return toPersona(globalOverride);

  try {
    const config = getConfig();
    return config.persona.default as Persona;
  } catch {
    return DEFAULT_PERSONA;
  }
}

export function setPersona(
  scope: 'global' | 'group' | 'user',
  scopeId: string | undefined,
  updates: Partial<Persona>,
): Persona {
  const current = scope === 'user'
    ? getPersona(scopeId)
    : scope === 'group'
      ? getPersona(undefined, scopeId)
      : getPersona();

  const merged: Persona = { ...current, ...updates };

  const db = getDb();
  const existing = getOverride(scope, scopeId);

  if (existing) {
    db.prepare(`
      UPDATE personas SET name = ?, system_prompt = ?, tone = ?, language = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(merged.name, merged.systemPrompt, merged.tone, merged.language, existing.id);
  } else {
    db.prepare(`
      INSERT INTO personas (id, scope, scope_id, name, system_prompt, tone, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nanoid(), scope, scopeId ?? null, merged.name, merged.systemPrompt, merged.tone, merged.language);
  }

  log.info({ scope, scopeId }, 'Persona updated');
  return merged;
}

export function getPreset(name: string): Persona | undefined {
  return PRESET_PERSONAS[name];
}

function getOverride(scope: string, scopeId?: string): PersonaOverride | undefined {
  const db = getDb();
  const row = scopeId
    ? db.prepare('SELECT * FROM personas WHERE scope = ? AND scope_id = ?').get(scope, scopeId) as any
    : db.prepare('SELECT * FROM personas WHERE scope = ? AND scope_id IS NULL').get(scope) as any;

  if (!row) return undefined;
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scope_id,
    name: row.name,
    systemPrompt: row.system_prompt,
    tone: row.tone,
    language: row.language,
  };
}

function toPersona(override: PersonaOverride): Persona {
  return {
    name: override.name,
    systemPrompt: override.systemPrompt,
    tone: override.tone as Persona['tone'],
    language: override.language,
  };
}
