import { useLiveQuery } from 'dexie-react-hooks';
import { CardHead } from '../../../components/CardHead';
import { db } from '../../../db/db';
import { startOfWeek } from '../../../lib/dates';
import { useSyncState } from '../../../sync/manager';
import type { FeedItem, Group } from '../../friends/api';
import { leaderboard, type Member } from '../../friends/stats';

interface Cached {
  groups: Group[];
  members: Record<string, Member[]>;
  feed: Record<string, FeedItem[]>;
}

/** Top of the first group's weekly leaderboard (from the last fetch — works offline). */
export function FriendsCard({ today }: { today: string }) {
  const uid = useSyncState().user?.id;
  const cached = useLiveQuery(async () => (uid ? ((await db.meta.get(`friends-cache:${uid}`))?.value as Cached | undefined) : undefined), [uid]);
  const group = cached?.groups[0];
  if (!group) return null;
  const rows = leaderboard(cached.members[group.id] ?? [], 'habit', startOfWeek(today)).filter((r) => r.rank !== null);
  if (rows.length < 2) return null;
  const me = rows.find((r) => r.member.me);

  return (
    <section className="card">
      <CardHead icon="trophy" tone="var(--pb)" title={group.name} link={{ to: '/more/friends', label: 'Leaderboard' }} />
      {me && (
        <p className="muted" style={{ fontSize: 15 }}>
          You’re <b style={{ color: 'var(--text)' }}>#{me.rank}</b> of {rows.length} on habit score this week.
        </p>
      )}
      <ol className="mini-board">
        {rows.slice(0, 3).map((r) => (
          <li key={r.member.userId} className={r.member.me ? 'me' : ''}>
            <span className="rank">{r.rank}</span>
            <span className="who">{r.member.me ? 'You' : r.member.name}</span>
            <b>{r.value}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}
