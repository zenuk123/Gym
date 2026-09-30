import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
import { plural } from '../../../lib/format';
import { isNative, nativePlatform } from '../../../pwa/platform';
import { connectHealth, disconnectHealth, healthAvailable, healthName, openHealthSettings, syncHealth, useNativeHealth } from '../health/nativeHealth';
import { ago } from './ago';

/** Apple Health / Health Connect: live sync in the native app, file import in the PWA. */
export function HealthCard() {
  return isNative() ? <NativeHealth /> : <WebHealth />;
}

function WebHealth() {
  return (
    <section className="card">
      <h2 className="chart-title">Apple Health</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        Web apps can’t read Apple Health directly, so bring your weight and sleep in from the Health app’s export file. Live sync comes with the Fitness OS app (installed through TestFlight — README §5).
      </p>
      <Link to="/more/health" className="btn btn-block">
        <Icon name="heart" /> Import from Apple Health
      </Link>
    </section>
  );
}

function NativeHealth() {
  const toast = useToast();
  const state = useNativeHealth();
  const [avail, setAvail] = useState<{ available: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = healthName();

  useEffect(() => {
    void healthAvailable().then(setAvail);
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doSync() {
    const c = await syncHealth();
    toast(c.weights || c.nights ? `Added ${plural(c.weights, 'weigh-in')} and ${plural(c.nights, 'night')} from ${name}` : `Up to date with ${name}`);
  }
  const sync = () => run(doSync);

  if (!state || !avail) return null;
  return (
    <section className="card">
      <h2 className="chart-title">{name}</h2>
      {!avail.available ? (
        <>
          <p className="muted" style={{ fontSize: 14 }}>
            {nativePlatform() === 'android' ? 'Health Connect isn’t available — install “Health Connect by Android” from the Play Store, then come back.' : `${name} isn’t available on this device.`}
          </p>
          {nativePlatform() === 'android' && (
            <button className="btn btn-block" onClick={() => void run(openHealthSettings)}>
              Open Health Connect
            </button>
          )}
        </>
      ) : state.enabled ? (
        <>
          <p className="muted" style={{ fontSize: 14 }}>
            Weight and sleep come in automatically when you open the app — only for days you haven’t logged here. Nothing is written back to {name}.
          </p>
          <p className="faint" style={{ fontSize: 13 }}>
            {state.lastSyncAt ? `Last checked ${ago(state.lastSyncAt)}` : 'Not synced yet'}
            {state.last ? ` · last time: ${plural(state.last.weights, 'weigh-in')}, ${plural(state.last.nights, 'night')}` : ''}
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy} onClick={() => void sync()}>
              <Icon name="refresh" /> {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn" disabled={busy} onClick={() => void run(disconnectHealth)}>
              Turn off
            </button>
          </div>
          {nativePlatform() === 'ios' && (
            <p className="faint" style={{ fontSize: 13 }}>
              To change what Fitness OS can read: Settings → Health → Data Access & Devices → Fitness OS.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14 }}>
            Read your weight and sleep (including watch sleep stages) from {name}. A year of history comes in first, then new days whenever you open the app.
          </p>
          <button
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await connectHealth();
                await doSync();
              })
            }
          >
            <Icon name="heart" /> Connect {name}
          </button>
        </>
      )}
      {error && <p className="chat-error">{error}</p>}
    </section>
  );
}
