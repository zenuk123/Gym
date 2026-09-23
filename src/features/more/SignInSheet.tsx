import { useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/NumberField';
import { Segmented } from '../../components/Segmented';
import { signIn, signUp } from '../../sync/manager';
import { useOnline } from '../../pwa/platform';

/**
 * Email + password (not magic links): links open in Safari, not the installed
 * Home Screen app, which has separate storage — so the login wouldn't stick.
 */
export function SignInSheet({ onClose, initialMode = 'signin' }: { onClose: () => void; initialMode?: 'signin' | 'signup' }) {
  const online = useOnline();
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length >= 8;

  async function submit() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        onClose();
      } else {
        const ready = await signUp(email.trim(), password);
        if (ready) onClose();
        else setInfo('Check your email to confirm your account, then sign in here.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={mode === 'signin' ? 'Sign in' : 'Create account'} onClose={onClose}>
      <Segmented
        label="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'signin', label: 'Sign in' },
          { value: 'signup', label: 'Create account' },
        ]}
      />
      <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <TextField
        label="Password (8+ characters)"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
      />
      {!online && <p className="error-text">You're offline — connect to sign in.</p>}
      {error && <p className="error-text">{error}</p>}
      {info && <p className="muted">{info}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid || busy || !online} onClick={() => void submit()}>
        {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
      <p className="faint" style={{ fontSize: 13 }}>
        Your data on this device is kept and uploaded to your account so it's backed up and available on other devices.
      </p>
    </Sheet>
  );
}
