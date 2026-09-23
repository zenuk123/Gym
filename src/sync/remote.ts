import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudConfigured } from './config';
import type { RemoteRow } from './mapping';

/**
 * Everything that talks to the cloud lives behind this interface so the sync
 * engine can be tested with a fake, and the backend could be swapped later.
 */
export interface RemoteAdapter {
  upsert(table: string, rows: RemoteRow[]): Promise<void>;
  /** Rows changed after `afterSeq`, ordered by `sync_seq`. */
  pullSince(table: string, afterSeq: number, limit: number): Promise<RemoteRow[]>;
}

export interface CloudUser {
  id: string;
  email: string | null;
}

let clientPromise: Promise<SupabaseClient> | null = null;

/** Supabase is loaded lazily so local-only users never download it. */
export function getClient(): Promise<SupabaseClient> {
  if (!cloudConfigured) return Promise.reject(new Error('Cloud sync is not configured'));
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  );
  return clientPromise;
}

export function supabaseAdapter(client: SupabaseClient): RemoteAdapter {
  return {
    async upsert(table, rows) {
      const { error } = await client.from(table).upsert(rows, { onConflict: 'user_id,id' });
      if (error) throw new Error(error.message);
    },
    async pullSince(table, afterSeq, limit) {
      const { data, error } = await client
        .from(table)
        .select('*')
        .gt('sync_seq', afterSeq)
        .order('sync_seq', { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as RemoteRow[];
    },
  };
}
