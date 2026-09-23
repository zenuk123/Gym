import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { createBackup, foodCSV, resetDevice, restoreBackup, saveFile, stampedName, waterCSV, weightsCSV } from '../../lib/backup';
import { useSyncState } from '../../sync/manager';

export function DataSettings() {
  const toast = useToast();
  const sync = useSyncState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const run = (fn: () => Promise<void>) => () => {
    setError(null);
    fn().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  async function onImport(file: File) {
    setError(null);
    try {
      const { restored, skipped } = await restoreBackup(JSON.parse(await file.text()));
      toast(`Restored ${restored} record${restored === 1 ? '' : 's'}${skipped ? ` · ${skipped} already up to date` : ''}`);
    } catch (err) {
      setError(err instanceof SyntaxError ? 'That file is not valid JSON.' : err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="page">
      <SubHeader title="Data & backup" />
      <p className="muted" style={{ padding: '0 4px' }}>
        Your fitness data belongs to you. Export it any time — on iPhone you can save to Files, iCloud Drive or send it anywhere.
      </p>

      <h2 className="section-title">Full backup</h2>
      <div className="list">
        <button
          className="list-row"
          style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}
          onClick={run(async () => saveFile(JSON.stringify(await createBackup(), null, 2), stampedName('fitness-os-backup', 'json'), 'application/json'))}
        >
          <span className="lead">
            <Icon name="download" />
          </span>
          <div className="grow">
            <div className="title">Export backup (JSON)</div>
            <div className="desc">Everything — restore it on any device</div>
          </div>
        </button>
        <button className="list-row" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties} onClick={() => fileRef.current?.click()}>
          <span className="lead">
            <Icon name="upload" />
          </span>
          <div className="grow">
            <div className="title">Restore from backup</div>
            <div className="desc">Merges — newer data is never overwritten</div>
          </div>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImport(f);
          e.target.value = '';
        }}
      />

      <h2 className="section-title">Spreadsheet (CSV)</h2>
      <div className="list">
        {[
          { title: 'Body weight', name: 'weights', get: weightsCSV },
          { title: 'Food log', name: 'food-log', get: foodCSV },
          { title: 'Water (daily totals)', name: 'water', get: waterCSV },
        ].map((x) => (
          <button
            key={x.name}
            className="list-row"
            style={{ '--tone': 'var(--weight)' } as React.CSSProperties}
            onClick={run(async () => saveFile(await x.get(), stampedName(x.name, 'csv'), 'text/csv'))}
          >
            <span className="lead">
              <Icon name="share" />
            </span>
            <div className="grow">
              <div className="title">{x.title}</div>
            </div>
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}

      <h2 className="section-title">Danger zone</h2>
      {confirmReset ? (
        <section className="card">
          <p>
            <b>Erase all data on this device?</b>
          </p>
          <p className="muted" style={{ fontSize: 14 }}>
            {sync.user
              ? 'Your cloud copy is kept and will download again while you stay signed in. Sign out first to start completely fresh.'
              : 'This cannot be undone. Export a backup first if you might want it back.'}
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={run(async () => {
                await resetDevice();
                window.location.reload();
              })}
            >
              Erase
            </button>
          </div>
        </section>
      ) : (
        <button className="btn btn-danger btn-block" onClick={() => setConfirmReset(true)}>
          <Icon name="trash" />
          Erase data on this device
        </button>
      )}
    </main>
  );
}
