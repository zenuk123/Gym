import { useCallback, useEffect, useRef } from 'react';

/**
 * Saves a value shortly after typing stops, and immediately when the component goes away.
 * Use for fields that used to save on blur: iOS doesn't always blur a field when you tap a
 * button or go back, so blur-only saves can silently lose an edit.
 */
export function useCommitOnLeave<T>(commit: (value: T) => void, delayMs = 600): (value: T) => void {
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(commit);
  latest.current = commit;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) latest.current(p.value);
  }, []);

  useEffect(() => flush, [flush]);

  return useCallback(
    (value: T) => {
      pending.current = { value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [delayMs, flush],
  );
}
