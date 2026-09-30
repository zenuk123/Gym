/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(at: number | string, now = Date.now()): string {
  const t = typeof at === 'string' ? Date.parse(at) : at;
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
