import { useEffect, useState, useSyncExternalStore } from 'react';
import { haptic } from '../../../pwa/platform';

/**
 * Rest timer stored as an absolute end time (localStorage), so it stays correct if
 * iOS suspends the app or it's reloaded mid-rest. iOS can't run JS in the background,
 * so the "rest over" cue plays when you're looking at the app (or the moment you return).
 */

interface RestState {
  endsAt: number;
  total: number;
}

const KEY = 'fos.rest';
let state: RestState | null = load();
const subs = new Set<() => void>();

function load(): RestState | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as RestState) : null;
    return s && s.endsAt > Date.now() - 60_000 ? s : null;
  } catch {
    return null;
  }
}

function set(next: RestState | null) {
  state = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: timer still works for this session */
  }
  subs.forEach((f) => f());
}

export function startRest(seconds: number) {
  unlockAudio();
  set({ endsAt: Date.now() + seconds * 1000, total: seconds });
}

export function adjustRest(deltaSec: number) {
  if (!state) return;
  const endsAt = Math.max(Date.now(), state.endsAt + deltaSec * 1000);
  set({ endsAt, total: Math.max(1, state.total + deltaSec) });
}

export const stopRest = () => set(null);

/** Seconds left (negative once finished), or null when no rest is running. Re-renders 4×/s while active. */
export function useRest(): { left: number; total: number } | null {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [s]);
  if (!s) return null;
  return { left: Math.ceil((s.endsAt - Date.now()) / 1000), total: s.total };
}

/** Plays the end-of-rest cue once per rest period. */
export function useRestAlarm(rest: { left: number } | null) {
  const [firedFor, setFiredFor] = useState<number | null>(null);
  const endsAt = state?.endsAt ?? null;
  useEffect(() => {
    if (rest && rest.left <= 0 && endsAt !== null && firedFor !== endsAt) {
      setFiredFor(endsAt);
      beep();
      haptic([200, 100, 200]);
    }
  }, [rest, endsAt, firedFor]);
}

// ── Sound: Web Audio must be unlocked by a tap on iOS ────────────────────
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no audio */
  }
}

function beep() {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [0, 0.25, 0.5].forEach((offset, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.frequency.value = i === 2 ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.2);
  });
}
