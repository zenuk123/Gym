import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { onNativeReminderTap } from './reminders';

/** Native app only: tapping a reminder opens the page it's about. */
export function NativeReminderTaps() {
  const navigate = useNavigate();
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void onNativeReminderTap((url) => navigate(url)).then((s) => (cancelled ? s() : (stop = s)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [navigate]);
  return null;
}
