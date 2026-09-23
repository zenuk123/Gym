import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { isIOS, isStandalone, useOnline } from '../../pwa/platform';

const PHASES = [
  { n: 1, title: 'Foundation', desc: 'Installable app, profile, targets, Today dashboard, offline + sync', done: true },
  { n: 2, title: 'Gym', desc: 'Routines, Gym Mode, set logging, PBs, progressive overload', done: true },
  { n: 3, title: 'Progress', desc: 'Measurements, goals, photos, analytics', done: true },
  { n: 4, title: 'Nutrition', desc: 'Food database, barcode scanner, custom foods, saved meals', done: true },
  { n: 5, title: 'Meal prep', desc: 'Weekly planner, batch cooking, shopping lists', done: true },
  { n: 6, title: 'AI coach', desc: 'Coach over your own data, AI meal ideas, weekly review, sleep', done: true },
  { n: 7, title: 'Integrations', desc: 'Barcode scanner and Apple Health import done · native wrapper, live Health sync and wearables later' },
];

export function AboutPage() {
  const online = useOnline();
  const installed = isStandalone();

  return (
    <main className="page">
      <SubHeader title="About & install" />

      <section className="card">
        <div className="card-head" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
          <span className="chip-icon">
            <Icon name="plusSquare" />
          </span>
          <h2>{installed ? 'Installed' : 'Install on your iPhone'}</h2>
        </div>
        {installed ? (
          <p className="muted">You're running the Home Screen app. It opens full-screen and works without signal.</p>
        ) : (
          <ol className="muted" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
            <li>Open this page in <b>Safari</b>{isIOS() ? '' : ' on your iPhone'}.</li>
            <li>
              Tap <Icon name="shareIos" className="inline-icon" style={{ display: 'inline', width: 16, height: 16, verticalAlign: -3 }} /> <b>Share</b>.
            </li>
            <li>
              Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
            </li>
            <li>Open Fitness OS from your Home Screen.</li>
          </ol>
        )}
        <div className="stat-grid">
          <div className="stat">
            <div className="label">Network</div>
            <div className="value" style={{ fontSize: 16 }}>
              {online ? 'Online' : 'Offline'}
            </div>
          </div>
          <div className="stat">
            <div className="label">Offline ready</div>
            <div className="value" style={{ fontSize: 16 }}>
              {'serviceWorker' in navigator && navigator.serviceWorker.controller ? 'Yes' : 'After reload'}
            </div>
          </div>
          <div className="stat">
            <div className="label">Version</div>
            <div className="value" style={{ fontSize: 16 }}>
              {__APP_VERSION__}
            </div>
          </div>
        </div>
      </section>

      <h2 className="section-title">Roadmap</h2>
      <div className="list">
        {PHASES.map((p) => (
          <div key={p.n} className="list-row" style={{ '--tone': p.done ? 'var(--success)' : 'var(--text-3)' } as React.CSSProperties}>
            <span className="lead">{p.done ? <Icon name="check" /> : <b>{p.n}</b>}</span>
            <div className="grow">
              <div className="title">{p.title}</div>
              <div className="desc">{p.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
