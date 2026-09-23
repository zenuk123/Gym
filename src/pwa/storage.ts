/**
 * Ask the browser to treat our IndexedDB data as persistent (not evictable under
 * storage pressure). Home-Screen apps on iOS are already exempt from Safari's
 * 7-day storage cap; this adds protection on other browsers.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
