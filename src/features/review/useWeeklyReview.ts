import { useMemo } from 'react';
import { useFoodLogsRange, useSleep, useWaterLogsRange, useWeights } from '../../db/hooks';
import type { ISODate, Profile } from '../../db/types';
import { weeklyReview, type WeeklyReview } from '../../lib/calc/review';
import { addDays, daysBetween } from '../../lib/dates';
import { useTraining } from '../workout/useTraining';

/** The review for the week starting `weekStart` (Monday). `undefined` while loading. */
export function useWeeklyReview(profile: Profile, weekStart: ISODate, today: ISODate): WeeklyReview | undefined {
  const t = useTraining();
  const weights = useWeights();
  const food = useFoodLogsRange(weekStart, addDays(weekStart, 6));
  const water = useWaterLogsRange(weekStart, addDays(weekStart, 6));
  const sleep = useSleep();
  return useMemo(() => {
    if (!t || !weights || !food || !water || !sleep) return undefined;
    const elapsedDays = Math.min(7, daysBetween(weekStart, today) + 1);
    return weeklyReview({ profile, weekStart, finished: t.finished, pbs: t.pbs, weights, foodLogs: food, water, sleep, elapsedDays });
  }, [t, weights, food, water, sleep, profile, weekStart, today]);
}

/** Sunday → this week; any other day → the last complete week. */
export function defaultReviewWeek(today: ISODate, thisWeek: ISODate): ISODate {
  return daysBetween(thisWeek, today) === 6 ? thisWeek : addDays(thisWeek, -7);
}
