import { describe, expect, it } from 'vitest';
import { dueReminders, localNow, sanitiseReminders, withDefaults, type Reminder } from '../../supabase/functions/_shared/reminders';

const weighIn: Reminder = { id: 'weigh-in', enabled: true, time: '07:30', days: [0, 1, 2, 3, 4, 5, 6] };
const workout: Reminder = { id: 'workout', enabled: true, time: '17:30', days: [1, 3, 5] };

describe('reminders', () => {
  it('reads local time in the phone’s time zone', () => {
    // 06:40 UTC on Wed 1 Jul 2026 = 07:40 in London (BST), 15:40 in Tokyo.
    const now = new Date(Date.UTC(2026, 6, 1, 6, 40));
    expect(localNow(now, 'Europe/London')).toEqual({ date: '2026-07-01', weekday: 3, minutes: 7 * 60 + 40 });
    expect(localNow(now, 'Asia/Tokyo').minutes).toBe(15 * 60 + 40);
    expect(localNow(now, 'Not/AZone').minutes).toBe(6 * 60 + 40); // falls back to UTC
  });

  it('sends a reminder once, within an hour of its time, only on its days', () => {
    const at = (h: number, m: number, d = 1) => new Date(Date.UTC(2026, 6, d, h - 1, m)); // London BST
    expect(dueReminders([weighIn], {}, at(7, 29), 'Europe/London')).toEqual([]);
    expect(dueReminders([weighIn], {}, at(7, 35), 'Europe/London')).toEqual([weighIn]);
    expect(dueReminders([weighIn], { 'weigh-in': '2026-07-01' }, at(7, 45), 'Europe/London')).toEqual([]);
    expect(dueReminders([weighIn], {}, at(9, 0), 'Europe/London')).toEqual([]); // too late — skip rather than nag
    expect(dueReminders([workout], {}, at(17, 40), 'Europe/London')).toEqual([workout]); // Wednesday
    expect(dueReminders([workout], {}, at(17, 40, 2), 'Europe/London')).toEqual([]); // Thursday
    expect(dueReminders([{ ...weighIn, enabled: false }], {}, at(7, 35), 'Europe/London')).toEqual([]);
  });

  it('cleans what devices send and fills in defaults', () => {
    expect(
      sanitiseReminders([
        { id: 'weigh-in', enabled: true, time: '07:30', days: [3, 1, 1, 9] },
        { id: 'hack', enabled: true, time: '07:30', days: [1] },
        { id: 'food', enabled: true, time: '25:00', days: [1] },
        { id: 'weigh-in', enabled: false, time: '08:00', days: [] },
      ]),
    ).toEqual([{ id: 'weigh-in', enabled: true, time: '07:30', days: [1, 3] }]);
    expect(sanitiseReminders('nope')).toEqual([]);
    const all = withDefaults([{ id: 'food', enabled: true, time: '19:00', days: [1] }]);
    expect(all.map((r) => r.id)).toEqual(['weigh-in', 'workout', 'food', 'review']);
    expect(all.find((r) => r.id === 'food')).toEqual({ id: 'food', enabled: true, time: '19:00', days: [1] });
  });
});
