import { useSyncExternalStore } from 'react';

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

type NativeBridge = { isNativePlatform?: () => boolean; getPlatform?: () => string };

/**
 * True inside the Capacitor wrapper (README §5). The native shell injects `window.Capacitor`,
 * so this needs no import and keeps the Capacitor packages out of the web bundle.
 */
export function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: NativeBridge }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  if (!isNative()) return 'web';
  return (globalThis as { Capacitor?: NativeBridge }).Capacitor?.getPlatform?.() === 'android' ? 'android' : 'ios';
}

/** True when launched from the Home Screen (no Safari chrome) — or running as the native app. */
export function isStandalone(): boolean {
  return (
    isNative() ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function subscribeOnline(fn: () => void) {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Light haptic tick. Android supports vibrate(); iOS Safari doesn't, so this is a silent no-op there. */
export function haptic(pattern: number | number[] = 10): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
