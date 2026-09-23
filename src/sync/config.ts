// Cloud sync is optional. With no Supabase credentials the app runs in
// local-only mode: everything works, data just lives on this device.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
