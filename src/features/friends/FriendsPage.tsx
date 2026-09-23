import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { TextField } from '../../components/NumberField';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { getMeta, setMeta } from '../../db/db';
import type { Profile } from '../../db/types';
import { PB_LABEL } from '../../lib/calc/training';
import { relativeDay, startOfWeek } from '../../lib/dates';
import { formatTimeAgo } from '../../lib/format';
import { formatWeight } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { cloudConfigured } from '../../sync/config';
import { useSyncState } from '../../sync/manager';
import { createGroup, groupFeed, groupMembers, joinGroup, leaveGroup, loadLocal, myGroups, myProfile, publish, rotateInvite, saveLocal, type FeedItem, type FriendsLocal, type Group } from './api';
import { ALL_SHARED, METRICS, SHARE_KEYS, SHARE_LABEL, leaderboard, missingReason, type Member, type Metric } from './stats';
import './friends.css';

interface Board {
  groups: Group[];
  members: Record<string, Member[]>;
  feed: Record<string, FeedItem[]>;
  fetchedAt: number;
}
const cacheKey = (uid: string) => `friends-cache:${uid}`;

export function FriendsPage({ profile }: { profile: Profile }) {
  const sync = useSyncState();
  const uid = sync.user?.id ?? null;

  if (!cloudConfigured)
    return (
      <main className="page">
        <SubHeader title="Friends" />
        <section className="card">
          <EmptyState icon="user">
            <b className="empty-title">Friends needs cloud accounts</b>
            Sharing progress goes through your Supabase project, so everyone signs in. Set it up once (README → “Optional: cloud accounts & sync”), then invite friends here.
          </EmptyState>
        </section>
      </main>
    );
  if (!uid)
    return (
      <main className="page">
        <SubHeader title="Friends" />
        <section className="card">
          <EmptyState icon="user">
            <b className="empty-title">Sign in to add friends</b>
            Each friend uses their own account. You only see what they choose to share, and they only see what you share.
          </EmptyState>
          <Link to="/more/account" className="btn btn-primary btn-block">
            Sign in or create account
          </Link>
        </section>
      </main>
    );
  return <Friends profile={profile} uid={uid} />;
}

function Friends({ profile, uid }: { profile: Profile; uid: string }) {
  const toast = useToast();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const [local, setLocal] = useState<FriendsLocal | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('habit');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stored = await loadLocal(uid);
      const remote = stored ? null : await myProfile(uid).catch(() => null);
      const groups = await myGroups();
      const l: FriendsLocal = stored ?? { inGroup: groups.length > 0, displayName: remote?.displayName ?? profile.name ?? '', share: remote?.share ?? ALL_SHARED };
      if (l.inGroup !== groups.length > 0) l.inGroup = groups.length > 0;
      await saveLocal(uid, l);
      setLocal(l);
      if (l.inGroup) await publish(uid, l).catch(() => {});
      const members: Board['members'] = {};
      const feed: Board['feed'] = {};
      for (const g of groups) {
        members[g.id] = await groupMembers(g.id, uid);
        feed[g.id] = await groupFeed(members[g.id]);
      }
      const b = { groups, members, feed, fetchedAt: Date.now() };
      setBoard(b);
      await setMeta(cacheKey(uid), b);
    } catch (e) {
      setError(navigator.onLine ? (e instanceof Error ? e.message : String(e)) : 'You’re offline — showing the last update.');
      const cached = await getMeta<Board>(cacheKey(uid));
      if (cached) setBoard((b) => b ?? cached);
      setLocal((l) => l ?? { inGroup: !!cached?.groups.length, displayName: profile.name ?? '', share: ALL_SHARED });
    } finally {
      setLoading(false);
    }
  }, [uid, profile.name]);

  useEffect(() => {
    void getMeta<Board>(cacheKey(uid)).then((c) => c && setBoard((b) => b ?? c));
    void refresh();
  }, [uid, refresh]);

  const group = board?.groups.find((g) => g.id === active) ?? board?.groups[0] ?? null;
  const members = useMemo(() => (group && board ? board.members[group.id] ?? [] : []), [group, board]);
  const rows = useMemo(() => leaderboard(members, metric, startOfWeek(today)), [members, metric, today]);

  async function afterJoin(g: Group, verb: string) {
    const l = { ...(local ?? { displayName: profile.name ?? '', share: ALL_SHARED }), inGroup: true };
    await saveLocal(uid, l);
    setLocal(l);
    await publish(uid, l, true).catch(() => {});
    setActive(g.id);
    setAdding(false);
    toast(`${verb} ${g.name}`);
    await refresh();
  }

  async function invite(g: Group) {
    const url = `${location.origin}${import.meta.env.BASE_URL}more/friends?join=${g.inviteCode}`;
    const text = `Join my Fitness OS group “${g.name}” so we can track our progress together: ${url}\n(or enter code ${g.inviteCode} in More → Friends)`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: 'Join my Fitness OS group', text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Invite copied');
      }
    } catch {
      /* cancelled */
    }
  }

  if (!local && loading) return <main className="page"><SubHeader title="Friends" /></main>;
  const joinCode = params.get('join');
  const noGroups = !board?.groups.length;

  return (
    <main className="page">
      <SubHeader title="Friends" />
      {error && <div className="banner"><Icon name="wifiOff" /><div className="grow">{error}</div></div>}

      {noGroups || adding ? (
        <>
          {noGroups && (
            <p className="muted" style={{ fontSize: 15 }}>
              Start a group and invite friends, or join theirs with an invite code. You’ll see a weekly leaderboard and each other’s PBs, streaks and goals.
            </p>
          )}
          <JoinOrCreate
            initialCode={joinCode ?? ''}
            onCreate={async (name) => afterJoin(await createGroup(name), 'Created')}
            onJoin={async (code) => {
              const g = await joinGroup(code);
              setParams({}, { replace: true });
              await afterJoin(g, 'Joined');
            }}
            onCancel={noGroups ? undefined : () => setAdding(false)}
          />
          {noGroups && local && <ShareSettingsCard uid={uid} local={local} onSaved={setLocal} first />}
        </>
      ) : (
        group &&
        board && (
          <>
            {board.groups.length > 1 && (
              <div className="chip-scroll" role="group" aria-label="Group">
                {board.groups.map((g) => (
                  <button key={g.id} className="chip" aria-pressed={g.id === group.id} onClick={() => setActive(g.id)}>
                    {g.name}
                  </button>
                ))}
              </div>
            )}
            <section className="card group-head">
              <div className="grow">
                <h2 className="chart-title">{group.name}</h2>
                <div className="faint" style={{ fontSize: 13 }}>
                  {members.length} {members.length === 1 ? 'member' : 'members'} · code <b className="code">{group.inviteCode}</b>
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => void invite(group)}>
                <Icon name="share" /> Invite
              </button>
            </section>

            <section className="card">
              <div className="card-head" style={{ '--tone': 'var(--pb)' } as React.CSSProperties}>
                <span className="chip-icon">
                  <Icon name="trophy" />
                </span>
                <h2>Leaderboard</h2>
                <button className="icon-btn board-refresh" onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
                  <Icon name="refresh" width={18} height={18} />
                </button>
              </div>
              <div className="chip-scroll" role="group" aria-label="Rank by">
                {(Object.keys(METRICS) as Metric[]).map((k) => (
                  <button key={k} className="chip" aria-pressed={k === metric} onClick={() => setMetric(k)}>
                    {METRICS[k].label}
                  </button>
                ))}
              </div>
              <p className="faint" style={{ fontSize: 12 }}>
                {METRICS[metric].weekly ? 'This week (Mon–Sun)' : 'Right now'} · {metricHint(metric)}
              </p>
              <ol className="board">
                {rows.map((r) => (
                  <li key={r.member.userId} className={`board-row${r.member.me ? ' me' : ''}`}>
                    <span className={`rank${r.rank && r.rank <= 3 ? ` top${r.rank}` : ''}`}>{r.rank ?? '–'}</span>
                    <span className="who">
                      <span className="name">
                        {r.member.name}
                        {r.member.me && <span className="faint"> (you)</span>}
                      </span>
                      {r.rank === null && (
                        <span className="desc">{missingReason(r.member, metric, startOfWeek(today))}</span>
                      )}
                    </span>
                    <span className="val">{r.value ?? '—'}</span>
                  </li>
                ))}
              </ol>
            </section>

            <h2 className="section-title">Activity</h2>
            {board.feed[group.id]?.length ? (
              <div className="list">
                {board.feed[group.id].slice(0, 30).map((f) => (
                  <div key={`${f.userId}-${f.event.key}`} className="list-row feed-row">
                    <span className="feed-icon" aria-hidden="true">
                      {f.event.kind === 'pb' ? '🏆' : f.event.kind === 'goal' ? '🎯' : f.event.kind === 'streak' ? '🔥' : '✅'}
                    </span>
                    <div className="grow">
                      <div className="title">{feedText(f, profile)}</div>
                      <div className="desc">{relativeDay(f.event.date, today)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="faint" style={{ padding: '0 4px' }}>
                PBs, goals and streaks from the last two weeks show up here.
              </p>
            )}

            <p className="faint" style={{ fontSize: 12, padding: '0 4px' }}>
              Updated {formatTimeAgo(board.fetchedAt)}. Your summary updates automatically after each sync.
            </p>

            {local && (showSettings ? <ShareSettingsCard uid={uid} local={local} onSaved={(l) => { setLocal(l); setShowSettings(false); void refresh(); }} /> : null)}
            <div className="list">
              <button className="list-row" onClick={() => setShowSettings((v) => !v)}>
                <div className="grow">
                  <div className="title">What I share</div>
                  <div className="desc">{local ? SHARE_KEYS.filter((k) => local.share[k]).map((k) => SHARE_LABEL[k].title).join(', ') || 'Nothing' : ''}</div>
                </div>
                <span className="trail">
                  <Icon name={showSettings ? 'x' : 'edit'} />
                </span>
              </button>
              <button className="list-row" onClick={() => setAdding(true)}>
                <div className="grow">
                  <div className="title">Create or join another group</div>
                </div>
                <span className="trail">
                  <Icon name="plus" />
                </span>
              </button>
            </div>
            <GroupAdmin
              group={group}
              onRotate={async () => {
                await rotateInvite(group.id);
                toast('New invite code — the old one no longer works');
                await refresh();
              }}
              onLeave={async () => {
                await leaveGroup(group.id);
                setActive(null);
                toast(`Left ${group.name}`);
                await refresh();
              }}
            />
          </>
        )
      )}
    </main>
  );
}

function metricHint(m: Metric) {
  switch (m) {
    case 'habit':
      return 'weekly review score out of 100';
    case 'workouts':
      return 'against each person’s own target';
    case 'streak':
      return 'weeks in a row hitting their target';
    case 'pbs':
      return 'personal bests set';
    case 'weight':
      return '% of the way to their weight goal';
    case 'calories':
      return 'days within 10% of their calorie target';
  }
}

function feedText(f: FeedItem, profile: Profile): string {
  const e = f.event;
  switch (e.kind) {
    case 'pb':
      return `${f.name} set a ${e.data.exercise} PB — ${formatWeight(e.data.weightKg, profile.weightUnit)} × ${e.data.reps}${e.data.pb === 'weight' ? '' : ` (${PB_LABEL[e.data.pb].toLowerCase()})`}`;
    case 'goal':
      return `${f.name} reached their ${e.data.name.toLowerCase()}`;
    case 'week':
      return `${f.name} hit their workout target (${e.data.done}/${e.data.target})`;
    case 'streak':
      return `${f.name} is on a ${e.data.weeks}-week streak`;
  }
}

function JoinOrCreate({ initialCode, onCreate, onJoin, onCancel }: { initialCode: string; onCreate: (name: string) => Promise<void>; onJoin: (code: string) => Promise<void>; onCancel?: () => void }) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="card">
        <h2 className="chart-title">Join a group</h2>
        <form
          className="barcode-manual"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => onJoin(code))();
          }}
        >
          <div className="input-wrap">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Invite code" aria-label="Invite code" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={12} className="code-input" />
          </div>
          <button className="btn btn-primary" disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length < 6}>
            Join
          </button>
        </form>
      </section>
      <section className="card">
        <h2 className="chart-title">Or start one</h2>
        <TextField label="Group name" value={name} onChange={setName} placeholder="e.g. Gym crew" />
        <button className="btn btn-block" disabled={busy || !name.trim()} onClick={run(() => onCreate(name))}>
          <Icon name="plus" /> Create group
        </button>
      </section>
      {error && <p className="chat-error" style={{ color: 'var(--danger)' }}>{error}</p>}
      {onCancel && (
        <button className="btn btn-ghost btn-block" onClick={onCancel}>
          Cancel
        </button>
      )}
    </>
  );
}

function ShareSettingsCard({ uid, local, onSaved, first }: { uid: string; local: FriendsLocal; onSaved: (l: FriendsLocal) => void; first?: boolean }) {
  const toast = useToast();
  const [draft, setDraftState] = useState(local);
  const [busy, setBusy] = useState(false);
  // Before joining a group there's nothing to publish, so changes are simply kept (no Save needed).
  const setDraft = (l: FriendsLocal) => {
    setDraftState(l);
    if (first) {
      void saveLocal(uid, l);
      onSaved(l);
    }
  };
  return (
    <section className="card">
      <h2 className="chart-title">{first ? 'What your friends will see' : 'What I share'}</h2>
      <TextField label="Your name in groups" value={draft.displayName} onChange={(v) => setDraft({ ...draft, displayName: v.slice(0, 30) })} placeholder="e.g. Ryan" />
      {SHARE_KEYS.map((k) => (
        <label key={k} className="check-row">
          <input type="checkbox" checked={draft.share[k]} onChange={(e) => setDraft({ ...draft, share: { ...draft.share, [k]: e.target.checked } })} />
          <span className="grow">
            <b>{SHARE_LABEL[k].title}</b>
            <span className="desc">{SHARE_LABEL[k].desc}</span>
          </span>
        </label>
      ))}
      <p className="faint" style={{ fontSize: 13 }}>
        Your food log, weigh-ins, photos, measurements and sleep are never shared — only these summaries, and only with people in your groups.
      </p>
      {!first && (
      <button
        className="btn btn-primary btn-block"
        disabled={busy || !draft.displayName.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await saveLocal(uid, draft);
            if (draft.inGroup) await publish(uid, draft, true);
            onSaved(draft);
            toast('Sharing updated');
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Couldn’t update — try again when online');
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </button>
      )}
    </section>
  );
}

function GroupAdmin({ group, onRotate, onLeave }: { group: Group; onRotate: () => Promise<void>; onLeave: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="btn-row">
      <button className="btn btn-ghost" onClick={() => void onRotate()}>
        <Icon name="refresh" /> New code
      </button>
      {confirm ? (
        <button className="btn btn-danger" onClick={() => void onLeave()}>
          Leave {group.name}?
        </button>
      ) : (
        <button className="btn btn-ghost" onClick={() => setConfirm(true)}>
          Leave group
        </button>
      )}
    </div>
  );
}
