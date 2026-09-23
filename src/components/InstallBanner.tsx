import { useState } from 'react';
import { Icon } from './Icon';
import { isIOS, isStandalone } from '../pwa/platform';
import { useInstallPrompt } from '../pwa/install';

const DISMISS_KEY = 'fos.installBannerDismissed';

/**
 * iOS Safari has no install prompt, so we show the Share → Add to Home Screen steps.
 * Chrome/Android/desktop get a real install button via `beforeinstallprompt`.
 */
export function InstallBanner() {
  const prompt = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (isStandalone() || dismissed) return null;
  if (!isIOS() && !prompt) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode */
    }
    setDismissed(true);
  };

  return (
    <div className="banner" role="note">
      <span className="banner-icon">
        <Icon name="plusSquare" />
      </span>
      <div className="grow">
        <strong>Install Fitness OS</strong>
        {isIOS() ? (
          <span className="muted">
            Tap <Icon name="shareIos" className="inline-icon" /> <b>Share</b>, then <b>Add to Home Screen</b> for the full-screen app — it works
            offline in the gym.
          </span>
        ) : (
          <>
            <span className="muted">Add it to your home screen for the full-screen app that works offline.</span>
            <button className="btn btn-primary" style={{ marginTop: 10, minHeight: 40 }} onClick={() => void prompt!()}>
              Install
            </button>
          </>
        )}
      </div>
      <button className="icon-btn" onClick={dismiss} aria-label="Dismiss" style={{ marginTop: -8, marginRight: -6 }}>
        <Icon name="x" width={20} height={20} />
      </button>
    </div>
  );
}
