export const formatInt = (n: number) => Math.round(n).toLocaleString('en-GB');

export function formatLitres(ml: number): string {
  return `${(ml / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L`;
}

export function formatTimeAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "1 set", "3 sets". */
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
