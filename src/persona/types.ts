export interface Persona {
  name: string;
  systemPrompt: string;
  tone: 'professional' | 'friendly' | 'humorous';
  language: string;
}

export interface PersonaOverride {
  id: string;
  scope: 'global' | 'group' | 'user';
  scopeId?: string;
  name: string;
  systemPrompt: string;
  tone: string;
  language: string;
}
