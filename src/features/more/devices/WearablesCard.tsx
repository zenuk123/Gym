import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
import { plural } from '../../../lib/format';
import { isStandalone, useOnline } from '../../../pwa/platform';
import { cloudConfigured } from '../../../sync/config';
import { useSyncState } from '../../../sync/manager';
import { PROVIDER_INFO, PROVIDERS, type Provider } from '../../../../supabase/functions/_shared/wearables';
import { ago } from './ago';
import { disconnect, startConnect, syncWearable, useWearablesLocal, wearableStatus, type ProviderStatus } from './wearablesApi';

/** Withings / Oura / Fitbit through your own server (tokens never touch the phone). */
export function WearablesCard() {
  const toast = useToast();
  const online = useOnline();
  const sync = useSyncState();
  const local = useWearablesLocal();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<ProviderStatus[] | null>(null);
  const [busy, setBusy] = useState<Provider | 'status' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = cloudConfigured && !!sync.user;

  const refresh = useCallback(async () => {
    if (!signedIn || !navigator.onLine) return;
    setBusy((b) => b ?? 'status');
    try {
      setStatus(await wearableStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => (b === 'status' ? null : b));
    }
  }, [signedIn]);

  async function doSync(p: Provider) {
    setBusy(p);
    setError(null);
    try {
      const c = await syncWearable(p);
      toast(c.weights || c.nights ? `Added ${plural(c.weights, 'weigh-in')} and ${plural(c.nights, 'night')} from ${PROVIDER_INFO[p].name}` : `${PROVIDER_INFO[p].name} is up to date`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // Back from the provider's login page (…/more/devices?wearable=oura).
  useEffect(() => {
    const ok = params.get('wearable') as Provider | null;
    const failed = params.get('wearable_error');
    if (!ok && !failed) return;
    setParams({}, { replace: true });
    if (failed) setError(failed);
    if (ok && PROVIDERS.includes(ok)) {
      toast(`${PROVIDER_INFO[ok].name} connected`);
      void doSync(ok);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A login finished in another window: pick it up when we're back.
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  async function connect(p: Provider) {
    setBusy(p);
    setError(null);
    try {
      const url = await startConnect(p);
      // Home Screen / native apps keep running underneath; a normal tab just goes there and comes back.
      if (isStandalone()) window.open(url, '_blank');
      else window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Provider) {
    setBusy(p);
    try {
      await disconnect(p);
      toast(`${PROVIDER_INFO[p].name} disconnected — data already imported stays`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <h2 className="chart-title">Wearables</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        Bring in weight and sleep from a smart scale, ring or tracker. Garmin, Whoop, Samsung and most others already write to Apple Health / Health Connect — use that instead.
      </p>
      {!cloudConfigured ? (
        <p className="faint" style={{ fontSize: 13 }}>
          Wearables need the optional cloud server (README §3–§5): the login tokens are kept there, never on the phone.
        </p>
      ) : !sync.user ? (
        <Link to="/more/account" className="btn btn-block">
          <Icon name="cloud" /> Sign in to connect a wearable
        </Link>
      ) : !online ? (
        <p className="faint">You’re offline.</p>
      ) : (
        <div>
          {PROVIDERS.map((p) => {
            const s = status?.find((x) => x.provider === p);
            const last = local?.last[p];
            return (
              <div key={p} className="device-row">
                <div className="grow">
                  <div className="title">{PROVIDER_INFO[p].name}</div>
                  <div className="desc">
                    {!s
                      ? PROVIDER_INFO[p].gives
                      : !s.available
                        ? 'Not set up on your server yet (README §5)'
                        : s.connected
                          ? `Connected${last ? ` · synced ${ago(last.at)}` : ''}`
                          : PROVIDER_INFO[p].gives}
                  </div>
                </div>
                {s?.connected ? (
                  <>
                    <button className="chip" disabled={!!busy} onClick={() => void doSync(p)} aria-label={`Sync ${PROVIDER_INFO[p].name}`}>
                      <Icon name="refresh" width={14} height={14} /> {busy === p ? 'Syncing…' : 'Sync'}
                    </button>
                    <button className="icon-btn" disabled={!!busy} onClick={() => void remove(p)} aria-label={`Disconnect ${PROVIDER_INFO[p].name}`}>
                      <Icon name="x" width={18} height={18} color="var(--text-3)" />
                    </button>
                  </>
                ) : (
                  <button className="chip" disabled={!!busy || !s?.available} onClick={() => void connect(p)}>
                    {busy === p ? 'Opening…' : 'Connect'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="chat-error">{error}</p>}
      <p className="faint" style={{ fontSize: 13 }}>
        Read-only. Only days you haven’t logged are added, and connected devices catch up automatically every few hours.
      </p>
    </section>
  );
}
