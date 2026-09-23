import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../../db/db';
import { SUPABASE_URL, cloudConfigured } from '../../sync/config';

// AI settings live in the local `meta` table: they never sync and never go into backups,
// so an API key stays on the device it was typed into.

export type AiMode = 'off' | 'key' | 'proxy';
export const AI_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', hint: 'Most capable — best analysis' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'Faster and cheaper' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];

export interface AiSettings {
  mode: AiMode;
  apiKey: string;
  model: AiModel;
}

const KEY = 'ai-settings';
export const DEFAULT_AI: AiSettings = { mode: 'off', apiKey: '', model: 'claude-opus-5' };

export async function loadAi(): Promise<AiSettings> {
  return { ...DEFAULT_AI, ...((await getMeta<Partial<AiSettings>>(KEY)) ?? {}) };
}

export const saveAi = (s: AiSettings) => setMeta(KEY, s);

export function useAiSettings(): AiSettings | undefined {
  return useLiveQuery(async () => ({ ...DEFAULT_AI, ...(((await db.meta.get(KEY))?.value as Partial<AiSettings> | undefined) ?? {}) }));
}

/** The proxy is a Supabase Edge Function (supabase/functions/claude) holding the API key server-side. */
export const proxyAvailable = cloudConfigured;
export const PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/claude` : '';

export const aiReady = (s: AiSettings | undefined) => !!s && (s.mode === 'key' ? s.apiKey.trim().length > 20 : s.mode === 'proxy' && proxyAvailable);
