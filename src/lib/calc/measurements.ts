import { MEASUREMENT_SITES, siteKey, type Measurement, type MeasurementSite } from '../../db/types';
import type { DatedValue } from './stats';

export const SITE_LABEL: Record<MeasurementSite, string> = {
  chest: 'Chest',
  waist: 'Waist',
  arms: 'Arms',
  thighs: 'Thighs',
  shoulders: 'Shoulders',
  hips: 'Hips',
  neck: 'Neck',
};

/** One site's values over time (cm), oldest first; check-ins that skipped the site are ignored. */
export function siteSeries(ms: Measurement[], site: MeasurementSite): DatedValue[] {
  const k = siteKey(site);
  return ms
    .filter((m) => m[k] !== null)
    .map((m) => ({ date: m.date, value: m[k] as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface SiteSummary {
  site: MeasurementSite;
  latest: DatedValue;
  first: DatedValue;
  previous: DatedValue | null;
  /** Since the previous measurement of this site. */
  change: number | null;
  sinceFirst: number;
  count: number;
}

export function summariseMeasurements(ms: Measurement[]): SiteSummary[] {
  return MEASUREMENT_SITES.flatMap((site) => {
    const s = siteSeries(ms, site);
    if (s.length === 0) return [];
    const latest = s[s.length - 1];
    const previous = s.length > 1 ? s[s.length - 2] : null;
    return [
      {
        site,
        latest,
        first: s[0],
        previous,
        change: previous ? latest.value - previous.value : null,
        sinceFirst: latest.value - s[0].value,
        count: s.length,
      },
    ];
  });
}
