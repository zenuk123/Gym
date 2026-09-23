import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { usePendingSyncCount } from '../../db/hooks';
import { formatTimeAgo } from '../../lib/format';
import { useOnline } from '../../pwa/platform';
import { signOut, syncNow, useSyncState } from '../../sync/manager';
import { SignInSheet } from './SignInSheet';

export function AccountSettings() {
  const sync = useSyncState();
  const pending = usePendingSyncCount() ?? 0;
  const online = useOnline();
  const toast = useToast();
  const [sheet, setSheet] = useState<null | 'signin' | 'signup'>(null);

  return (
    <main className="page">
      <SubHeader title="Account & sync" />

      {sync.status === 'local-only' ? (
        <section className="card">
          <div className="card-head" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
            <span className="chip-icon">
              <Icon name="lock" />
            </span>
            <h2>On-device mode</h2>
          </div>
          <p className="muted">
            Everything is saved on this iPhone and works fully offline. Cloud backup & multi-device sync switch on once a Supabase project is connected
            (see the README) — your existing data is uploaded automatically when you first sign in.
          </p>
          <p className="muted">Until then, use Data & backup to export a copy regularly.</p>
        </section>
      ) : sync.user ? (
        <section className="card">
          <div className="card-head" style={{ '--tone': 'var(--water)' } as React.CSSProperties}>
            <span className="chip-icon">
              <Icon name="cloud" />
            </span>
            <h2>Signed in</h2>
          </div>
          <div className="big-num" style={{ fontSize: 20, wordBreak: 'break-all' }}>
            {sync.user.email}
          </div>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Status</div>
              <div className="value" style={{ fontSize: 16 }}>
                {!online ? 'Offline' : sync.status === 'syncing' ? 'Syncing…' : sync.status === 'error' ? 'Error' : 'Up to date'}
              </div>
            </div>
            <div className="stat">
              <div className="label">Waiting to upload</div>
              <div className="value" style={{ fontSize: 16 }}>
                {pending}
              </div>
            </div>
            <div className="stat">
              <div className="label">Last sync</div>
              <div className="value" style={{ fontSize: 16 }}>
                {sync.lastSyncedAt ? formatTimeAgo(sync.lastSyncedAt) : 'Never'}
              </div>
            </div>
          </div>
          {sync.lastError && <p className="error-text">{sync.lastError}</p>}
          {!online && <p className="muted">Changes are saved on this device and will upload automatically when you're back online.</p>}
          <div className="btn-row">
            <button
              className="btn"
              disabled={!online || sync.status === 'syncing'}
              onClick={() => void syncNow({ force: true }).then(() => toast('Sync complete'))}
            >
              <Icon name="refresh" />
              Sync now
            </button>
            <button className="btn btn-ghost" onClick={() => void signOut().then(() => toast('Signed out — data kept on this device'))}>
              Sign out
            </button>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card-head" style={{ '--tone': 'var(--water)' } as React.CSSProperties}>
            <span className="chip-icon">
              <Icon name="cloudOff" />
            </span>
            <h2>Not backed up</h2>
          </div>
          <p className="muted">Create a free account to back up your data and use it on other devices. The app keeps working offline either way.</p>
          {sync.lastError && <p className="error-text">{sync.lastError}</p>}
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => setSheet('signup')}>
              Create account
            </button>
            <button className="btn" onClick={() => setSheet('signin')}>
              Sign in
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head" style={{ '--tone': 'var(--text-2)' } as React.CSSProperties}>
          <span className="chip-icon">
            <Icon name="info" />
          </span>
          <h2>How sync works</h2>
        </div>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: 'grid', gap: 6 }}>
          <li>Every change is saved on your phone first — no signal needed.</li>
          <li>Changes queue up and upload when you're back online, retrying automatically.</li>
          <li>If the same thing was edited on two devices, the most recent edit wins.</li>
        </ul>
      </section>

      {sheet && <SignInSheet initialMode={sheet} onClose={() => setSheet(null)} />}
    </main>
  );
}
