import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { useSyncState } from '../sync/manager';
import { usePendingSyncCount } from '../db/hooks';
import { useOnline } from '../pwa/platform';

/** Small status pill in the Today header: offline / pending / synced. Taps through to Account & sync. */
export function SyncBadge() {
  const { status } = useSyncState();
  const pending = usePendingSyncCount() ?? 0;
  const online = useOnline();

  let cls = 'pill';
  let icon: 'cloud' | 'cloudOff' | 'refresh' | 'wifiOff' | 'lock' = 'cloud';
  let text = 'Synced';
  if (!online) {
    icon = 'wifiOff';
    text = 'Offline';
    cls += ' warn';
  } else if (status === 'local-only') {
    icon = 'lock';
    text = 'On device';
  } else if (status === 'signed-out') {
    icon = 'cloudOff';
    text = 'Not synced';
  } else if (status === 'syncing') {
    icon = 'refresh';
    text = 'Syncing';
  } else if (status === 'error') {
    icon = 'cloudOff';
    text = 'Sync issue';
    cls += ' bad';
  } else if (pending > 0) {
    icon = 'refresh';
    text = `${pending} to sync`;
  } else {
    cls += ' good';
  }

  return (
    <Link to="/more/account" className={cls} aria-label={`Sync status: ${text}`}>
      <Icon name={icon} />
      {text}
    </Link>
  );
}
