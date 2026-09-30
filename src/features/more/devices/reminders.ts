import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../../../db/db';
import { cloudConfigured } from '../../../sync/config';
import { currentUserId } from '../../../sync/manager';
import { invokeFunction } from '../../../sync/functions';
import { getClient } from '../../../sync/remote';
import { isIOS, isNative, isStandalone } from '../../../pwa/platform';
import { REMINDER_TEXT, withDefaults, type Reminder } from '../../../../supabase/functions/_shared/reminders';

// Reminders are device settings (local `meta`, never synced). Delivery:
//   native app → on-device scheduled notifications (work offline, no server);
//   installed PWA → Web Push through the `push` Edge Function (needs a cloud account).

const KEY = 'reminders';
const PUSH_KEY = 'reminders.push';
const NOTIF_BASE = 1000;

export type Delivery = 'native' | 'push' | 'install-first' | 'needs-account' | 'unsupported';

export function useReminders(): Reminder[] | undefined {
  return useLiveQuery(async () => withDefaults((await db.meta.get(KEY))?.value as Reminder[] | undefined), []);
}

export function useWebPushEndpoint(): string | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get(PUSH_KEY))?.value as { endpoint: string } | undefined)?.endpoint ?? null, []);
}

export function delivery(): Delivery {
  if (isNative()) return 'native';
  const pushable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!pushable) return isIOS() && !isStandalone() ? 'install-first' : 'unsupported';
  if (isIOS() && !isStandalone()) return 'install-first'; // iOS only allows push for Home Screen apps
  if (!cloudConfigured || !currentUserId()) return 'needs-account';
  return 'push';
}

// ── Native (Capacitor LocalNotifications) ────────────────────────────────
// The module, not the plugin proxy (see nativeHealth.ts: a proxy can't resolve a promise).
const loadNative = () => import('@capacitor/local-notifications');

async function scheduleNative(reminders: Reminder[]): Promise<void> {
  const { LocalNotifications: ln } = await loadNative();
  const pending = await ln.getPending();
  const ours = pending.notifications.filter((n) => n.id >= NOTIF_BASE && n.id < NOTIF_BASE + 100);
  if (ours.length) await ln.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  const on = reminders.filter((r) => r.enabled && r.days.length);
  if (!on.length) return;
  if ((await ln.requestPermissions()).display !== 'granted') throw new Error('Notifications are turned off for Fitness OS in Settings.');
  const all = withDefaults([]).map((r) => r.id);
  await ln.schedule({
    notifications: on.flatMap((r) =>
      r.days.map((day) => ({
        id: NOTIF_BASE + all.indexOf(r.id) * 10 + day,
        title: REMINDER_TEXT[r.id].title,
        body: REMINDER_TEXT[r.id].body,
        extra: { url: REMINDER_TEXT[r.id].url },
        schedule: { on: { weekday: day + 1, hour: Number(r.time.slice(0, 2)), minute: Number(r.time.slice(3, 5)) }, allowWhileIdle: true },
      })),
    ),
  });
}

/** Opens the right page when a native reminder is tapped. */
export async function onNativeReminderTap(go: (url: string) => void): Promise<() => void> {
  const h = await (await loadNative()).LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const url = (a.notification.extra as { url?: string } | undefined)?.url;
    if (url) go(url);
  });
  return () => void h.remove();
}

// ── Web Push ─────────────────────────────────────────────────────────────
function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

const pushFn = <T,>(body: Record<string, unknown>) => invokeFunction<T>('push', body);

async function subscribePush(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed. You can allow them in Settings → Notifications → Fitness OS.');
  const { publicKey } = await pushFn<{ publicKey: string | null }>({ action: 'config' });
  if (!publicKey) throw new Error('The reminders server has no VAPID keys yet (see README §5).');
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
}

async function savePush(reminders: Reminder[]): Promise<void> {
  const uid = currentUserId();
  if (!uid) throw new Error('Sign in to get reminders.');
  const sub = (await subscribePush()).toJSON();
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys.auth) throw new Error('This browser returned an incomplete push subscription.');
  const client = await getClient();
  const { error } = await client.from('push_subscriptions').upsert(
    { user_id: uid, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', reminders, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,endpoint' },
  );
  if (error) throw new Error(error.message);
  await setMeta(PUSH_KEY, { endpoint: sub.endpoint });
}

/** Stops push reminders on this device (unsubscribes and removes the server row). */
export async function turnOffPush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const client = await getClient();
    await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  await setMeta(PUSH_KEY, null);
}

export async function sendTestPush(): Promise<void> {
  const endpoint = (await getMeta<{ endpoint: string }>(PUSH_KEY))?.endpoint;
  if (!endpoint) throw new Error('Turn a reminder on first.');
  await pushFn({ action: 'test', endpoint });
}

/**
 * Saves the reminder settings and applies them to this device's delivery method.
 * Settings are saved even when delivery fails, and the error explains what's missing.
 */
export async function saveReminders(reminders: Reminder[]): Promise<void> {
  await setMeta(KEY, reminders);
  const d = delivery();
  if (d === 'native') return scheduleNative(reminders);
  if (d === 'push') {
    const anyOn = reminders.some((r) => r.enabled);
    const registered = !!(await getMeta<{ endpoint: string } | null>(PUSH_KEY))?.endpoint;
    if (anyOn || registered) await savePush(reminders);
  }
}
