import { getClient } from './remote';

/**
 * Calls one of our Supabase Edge Functions as the signed-in user and returns its JSON.
 * Errors carry the function's own message ({ error }) rather than a generic status text.
 */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const client = await getClient();
  const { data, error } = await client.functions.invoke(name, { body });
  if (!error) return data as T;
  const res = (error as { context?: unknown }).context;
  if (res instanceof Response) {
    const detail = await res
      .clone()
      .json()
      .then((j: { error?: string }) => j.error)
      .catch(() => null);
    if (detail) throw new Error(detail);
    if (res.status === 404) throw new Error(`The “${name}” function isn’t deployed on your server yet (README §5).`);
  }
  if (/Failed to send/i.test(error.message)) throw new Error(navigator.onLine ? `Couldn’t reach the “${name}” function — is it deployed (README §5)?` : 'You’re offline.');
  throw new Error(error.message);
}
