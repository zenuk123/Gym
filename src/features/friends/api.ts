import { getMeta, setMeta } from '../../db/db';
import { loadLocalData } from '../../db/localData';
import { cloudConfigured } from '../../sync/config';
import { getClient } from '../../sync/remote';
import { ALL_SHARED, buildEvents, buildStats, type FriendEvent, type FriendStats, type Member, type ShareSettings } from './stats';

// Everything Friends-related that talks to Supabase (tables + RPCs from migration 0007).

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
}

export interface FeedItem {
  userId: string;
  name: string;
  event: FriendEvent;
}

/** Per-account local cache: are we in any group, what we share, and what was last published. */
export interface FriendsLocal {
  inGroup: boolean;
  displayName: string;
  share: ShareSettings;
  lastHash?: string;
  lastAt?: number;
}

const localKey = (uid: string) => `friends:${uid}`;
export const loadLocal = async (uid: string): Promise<FriendsLocal | undefined> => getMeta<FriendsLocal>(localKey(uid));
export const saveLocal = (uid: string, v: FriendsLocal) => setMeta(localKey(uid), v);

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const client = await getClient();
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

type GroupRow = { id: string; name: string; invite_code: string };
const toGroup = (g: GroupRow): Group => ({ id: g.id, name: g.name, inviteCode: g.invite_code });

export async function myGroups(): Promise<Group[]> {
  const client = await getClient();
  const { data, error } = await client.from('friend_groups').select('id, name, invite_code').order('created_at');
  if (error) throw new Error(error.message);
  return (data as GroupRow[]).map(toGroup);
}

export const createGroup = async (name: string) => toGroup(await rpc<GroupRow>('fos_create_group', { p_name: name }));
export const joinGroup = async (code: string) => toGroup(await rpc<GroupRow>('fos_join_group', { p_code: code }));
export const leaveGroup = (id: string) => rpc<void>('fos_leave_group', { p_group: id });
export const rotateInvite = (id: string) => rpc<string>('fos_rotate_invite', { p_group: id });

/** My own shared profile (so settings follow me across devices). */
export async function myProfile(uid: string): Promise<{ displayName: string; share: ShareSettings } | null> {
  const client = await getClient();
  const { data, error } = await client.from('friend_profiles').select('display_name, share').eq('user_id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { displayName: data.display_name, share: { ...ALL_SHARED, ...(data.share as Partial<ShareSettings>) } } : null;
}

/** Everyone in a group with their shared stats (people who haven't published yet have `stats: null`). */
export async function groupMembers(groupId: string, uid: string): Promise<Member[]> {
  const client = await getClient();
  const { data: rows, error } = await client.from('friend_members').select('user_id').eq('group_id', groupId);
  if (error) throw new Error(error.message);
  const ids = (rows as { user_id: string }[]).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data: profiles, error: e2 } = await client.from('friend_profiles').select('user_id, display_name, stats, updated_at').in('user_id', ids);
  if (e2) throw new Error(e2.message);
  const byId = new Map((profiles as { user_id: string; display_name: string; stats: FriendStats; updated_at: string }[]).map((p) => [p.user_id, p]));
  return ids.map((id) => {
    const p = byId.get(id);
    const stats = p && p.stats && typeof p.stats === 'object' && 'weekStart' in p.stats ? p.stats : null;
    return { userId: id, name: p?.display_name ?? 'New member', stats, updatedAt: p?.updated_at ?? null, me: id === uid };
  });
}

export async function groupFeed(members: Member[]): Promise<FeedItem[]> {
  if (!members.length) return [];
  const client = await getClient();
  const { data, error } = await client
    .from('friend_events')
    .select('user_id, key, kind, date, data')
    .in('user_id', members.map((m) => m.userId))
    .order('date', { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);
  const names = new Map(members.map((m) => [m.userId, m.name]));
  return (data as { user_id: string; key: string; kind: FriendEvent['kind']; date: string; data: FriendEvent['data'] }[]).map((r) => ({
    userId: r.user_id,
    name: names.get(r.user_id) ?? 'Friend',
    event: { key: r.key, kind: r.kind, date: r.date, data: r.data } as FriendEvent,
  }));
}

const quote = (k: string) => `"${k.replace(/"/g, '')}"`;

/** Compute and upload my summary + feed events. Removes my events that are no longer shared or recent. */
export async function publish(uid: string, local: FriendsLocal, force = false): Promise<boolean> {
  const d = await loadLocalData();
  const stats = buildStats(d, local.share);
  const events = buildEvents(d, local.share);
  const hash = JSON.stringify([local.displayName, local.share, stats, events]);
  // Skip if nothing changed (but refresh a few times a day so "updated" stays honest).
  if (!force && hash === local.lastHash && Date.now() - (local.lastAt ?? 0) < 6 * 3600_000) return false;
  const client = await getClient();
  const { error } = await client
    .from('friend_profiles')
    .upsert({ user_id: uid, display_name: local.displayName.trim().slice(0, 30) || 'Friend', share: local.share, stats, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  if (events.length) {
    const { error: e2 } = await client.from('friend_events').upsert(
      events.map((e) => ({ user_id: uid, key: e.key, kind: e.kind, date: e.date, data: e.data })),
      { onConflict: 'user_id,key' },
    );
    if (e2) throw new Error(e2.message);
  }
  let del = client.from('friend_events').delete().eq('user_id', uid);
  if (events.length) del = del.not('key', 'in', `(${events.map((e) => quote(e.key)).join(',')})`);
  const { error: e3 } = await del;
  if (e3) throw new Error(e3.message);
  await saveLocal(uid, { ...local, lastHash: hash, lastAt: Date.now() });
  return true;
}

/** Called after every successful sync: publishes only if this account is in a group. */
export async function publishIfEnabled(uid: string): Promise<void> {
  if (!cloudConfigured) return;
  const local = await loadLocal(uid);
  if (!local?.inGroup) return;
  await publish(uid, local);
}
