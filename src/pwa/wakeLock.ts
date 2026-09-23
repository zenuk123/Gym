import { useEffect } from 'react';

/**
 * Keep the screen on (Gym Mode). Supported in iOS Home Screen apps from iOS 16.4+/18.4
 * and in Chrome; silently does nothing elsewhere. The lock is dropped by the browser when
 * the app is hidden, so it's re-requested on return.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        if (document.visibilityState !== 'visible') return;
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release();
      } catch {
        /* denied (low power mode etc.) */
      }
    };
    void request();
    const onVis = () => void request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);
}
