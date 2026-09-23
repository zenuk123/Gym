import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registers the service worker (offline app shell) and offers a one-tap
 * reload when a new version has been deployed. We never reload on our own —
 * that could interrupt someone mid-entry.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for new deployments hourly while the app stays open.
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="toast-host" style={{ top: 'auto', bottom: 'calc(var(--nav-h) + var(--safe-bottom) + 12px)' }}>
      <div className="toast">
        <span>A new version is ready.</span>
        <button className="toast-action" onClick={() => void updateServiceWorker(true)}>
          Update
        </button>
        <button className="toast-action" style={{ color: 'var(--text-2)' }} onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    </div>
  );
}
