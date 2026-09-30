import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
import { useSyncState } from '../../../sync/manager';
import { REMINDER_TEXT, type Reminder } from '../../../../supabase/functions/_shared/reminders';
import { delivery, saveReminders, sendTestPush, turnOffPush, useReminders, useWebPushEndpoint } from './reminders';

// Monday first, stored as 0 = Sunday … 6 = Saturday.
const DAYS = [
  { d: 1, l: 'M', name: 'Monday' },
  { d: 2, l: 'T', name: 'Tuesday' },
  { d: 3, l: 'W', name: 'Wednesday' },
  { d: 4, l: 'T', name: 'Thursday' },
  { d: 5, l: 'F', name: 'Friday' },
  { d: 6, l: 'S', name: 'Saturday' },
  { d: 0, l: 'S', name: 'Sunday' },
];

export function RemindersCard() {
  useSyncState(); // re-render when you sign in/out (delivery depends on it)
  const toast = useToast();
  const saved = useReminders();
  const endpoint = useWebPushEndpoint();
  const [draft, setDraft] = useState<Reminder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const how = delivery();
  const list = draft ?? saved;

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function change(next: Reminder[]) {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    // Time wheels fire many changes; apply once they settle.
    timer.current = setTimeout(() => {
      setError(null);
      saveReminders(next).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 600);
  }

  const patch = (id: Reminder['id'], p: Partial<Reminder>) => list && change(list.map((r) => (r.id === id ? { ...r, ...p } : r)));

  async function act(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!list) return null;
  return (
    <section className="card">
      <h2 className="chart-title">Reminders</h2>
      <DeliveryNote how={how} />
      {how !== 'unsupported' &&
        list.map((r) => (
          <div key={r.id} className="reminder">
            <label className="check-row">
              <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r.id, { enabled: e.target.checked })} disabled={how === 'install-first' || how === 'needs-account'} />
              <span className="grow">
                <b>{REMINDER_TEXT[r.id].label}</b>
                <span className="desc">{REMINDER_TEXT[r.id].body}</span>
              </span>
            </label>
            {r.enabled && (
              <div className="reminder-when">
                <div className="input-wrap time">
                  <input type="time" aria-label={`${REMINDER_TEXT[r.id].label} time`} value={r.time} onChange={(e) => e.target.value && patch(r.id, { time: e.target.value })} />
                </div>
                <div className="day-chips" role="group" aria-label="Days">
                  {DAYS.map((d) => (
                    <button
                      key={d.d}
                      className="chip"
                      aria-pressed={r.days.includes(d.d)}
                      aria-label={d.name}
                      onClick={() => patch(r.id, { days: r.days.includes(d.d) ? r.days.filter((x) => x !== d.d) : [...r.days, d.d].sort((a, b) => a - b) })}
                    >
                      {d.l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      {error && <p className="chat-error">{error}</p>}
      {how === 'push' && endpoint && (
        <div className="btn-row">
          <button className="btn" disabled={busy} onClick={() => void act(sendTestPush, 'Test sent — it should arrive in a few seconds')}>
            <Icon name="send" /> Send a test
          </button>
          <button className="btn" disabled={busy} onClick={() => void act(turnOffPush, 'Reminders turned off on this device')}>
            Turn off here
          </button>
        </div>
      )}
      <p className="faint" style={{ fontSize: 13 }}>
        Reminders never change your plan or targets — they just nudge you. Settings stay on this device.
      </p>
    </section>
  );
}

function DeliveryNote({ how }: { how: ReturnType<typeof delivery> }) {
  switch (how) {
    case 'native':
      return <p className="muted" style={{ fontSize: 14 }}>Scheduled on this phone — they work offline.</p>;
    case 'push':
      return <p className="muted" style={{ fontSize: 14 }}>Sent by your server as notifications to this device, even when the app is closed.</p>;
    case 'install-first':
      return (
        <p className="muted" style={{ fontSize: 14 }}>
          On iPhone, notifications only work for the Home Screen app (iOS 16.4 or later). Open Fitness OS from your Home Screen to switch them on — see <Link to="/more/about">About & install</Link>.
        </p>
      );
    case 'needs-account':
      return (
        <p className="muted" style={{ fontSize: 14 }}>
          Notifications in the web app are sent by your cloud server, so <Link to="/more/account">sign in</Link> first (the native app doesn’t need this).
        </p>
      );
    default:
      return <p className="muted" style={{ fontSize: 14 }}>This browser can’t show notifications.</p>;
  }
}
