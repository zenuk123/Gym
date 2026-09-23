export type ThemePref = 'system' | 'dark' | 'light';
const KEY = 'fos.theme';

// Theme is a per-device preference (kept in localStorage, not synced).
export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'system' || v === 'light' ? v : 'dark'; // dark-first design
  } catch {
    return 'dark';
  }
}

export function applyTheme(pref: ThemePref = getThemePref()): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const light = pref === 'light' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f2f3f6' : '#0b0d10');
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* private mode */
  }
  applyTheme(pref);
}

export function watchSystemTheme(): void {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme());
}
