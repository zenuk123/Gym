// Tiny pub/sub so the data layer can nudge the sync engine without importing it.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onLocalChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyLocalChange(): void {
  listeners.forEach((fn) => fn());
}
