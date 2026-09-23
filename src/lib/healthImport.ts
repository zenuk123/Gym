import type { ISODate } from '../db/types';
import { toISODate } from './dates';

// Apple Health import without a Mac or native app: the Health app can export everything as
// `export.zip` (Files can unzip it to `export.xml`). That file is often hundreds of MB, so it is
// scanned as a stream, keeping only body-mass and sleep records. Pure + tested; the UI decides
// what to import, and nothing is written without the user confirming.

export interface HealthWeight {
  date: ISODate;
  weightKg: number;
}

export interface HealthNight {
  /** Wake-up date (how the app files sleep). */
  date: ISODate;
  bedTime: string;
  wakeTime: string;
  durationMin: number;
  source: string;
}

interface Segment {
  start: Date;
  end: Date;
  asleep: boolean;
  source: string;
}

const WEIGHT = 'HKQuantityTypeIdentifierBodyMass';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const RECORD = /<Record\s([^>]*?)\/?>/g;
const ATTR = /(\w+)="([^"]*)"/g;

/** "2024-05-14 07:31:12 +0100" → Date */
export function parseHealthDate(s: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function toKg(value: number, unit: string): number | null {
  if (unit === 'kg') return value;
  if (unit === 'lb') return value * 0.45359237;
  if (unit === 'g') return value / 1000;
  if (unit === 'st') return value * 6.35029318;
  return null;
}

/** Streaming scanner: feed text chunks with `push`, then call `result()`. */
export class HealthScanner {
  private tail = '';
  private weights = new Map<ISODate, { at: number; kg: number }>();
  private segments: Segment[] = [];
  records = 0;

  push(chunk: string) {
    const text = this.tail + chunk;
    // Keep an unfinished tag for the next chunk.
    const cut = text.lastIndexOf('<');
    const closed = cut >= 0 && text.indexOf('>', cut) === -1 ? cut : text.length;
    this.scan(text.slice(0, closed));
    this.tail = text.slice(closed);
    if (this.tail.length > 1_000_000) this.tail = ''; // malformed: never grow without bound
  }

  private scan(text: string) {
    RECORD.lastIndex = 0;
    for (let m = RECORD.exec(text); m; m = RECORD.exec(text)) {
      const raw = m[1];
      if (!raw.includes(WEIGHT) && !raw.includes(SLEEP)) continue;
      const a: Record<string, string> = {};
      ATTR.lastIndex = 0;
      for (let x = ATTR.exec(raw); x; x = ATTR.exec(raw)) a[x[1]] = x[2];
      const start = parseHealthDate(a.startDate ?? '');
      if (!start) continue;
      this.records++;
      if (a.type === WEIGHT) {
        const kg = toKg(Number(a.value), a.unit ?? '');
        if (kg === null || !(kg > 20 && kg < 400)) continue;
        const date = toISODate(start);
        const prev = this.weights.get(date);
        // One per day: the earliest reading (morning weigh-ins are the most comparable).
        if (!prev || start.getTime() < prev.at) this.weights.set(date, { at: start.getTime(), kg });
      } else if (a.type === SLEEP) {
        const end = parseHealthDate(a.endDate ?? '');
        if (!end || end <= start || end.getTime() - start.getTime() > 16 * 3_600_000) continue;
        const v = a.value ?? '';
        if (v.endsWith('Awake')) continue;
        this.segments.push({ start, end, asleep: v.includes('Asleep'), source: a.sourceName ?? 'Health' });
      }
    }
  }

  result(): { weights: HealthWeight[]; nights: HealthNight[] } {
    this.scan(this.tail);
    this.tail = '';
    const weights = [...this.weights.entries()].map(([date, w]) => ({ date, weightKg: Math.round(w.kg * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date));
    return { weights, nights: nightsFrom(this.segments) };
  }
}

/**
 * Turn sleep segments into one night per wake-up date. Each source's segments are grouped into
 * sessions (a gap of more than 90 minutes starts a new one); a session is a night if it lasts at
 * least 2 hours and ends before 3 pm, and is filed under the date it ends. When a phone and a
 * watch both recorded the night, one source is chosen rather than adding them up (their segments
 * overlap): sources with real sleep stages (a watch) beat "in bed" estimates, then the longer wins.
 */
export function nightsFrom(segments: Segment[]): HealthNight[] {
  const bySource = new Map<string, Segment[]>();
  for (const s of segments) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);
  const best = new Map<ISODate, HealthNight & { staged: boolean }>();
  for (const [source, segs] of bySource) {
    const sorted = [...segs].sort((a, b) => a.start.getTime() - b.start.getTime());
    const sessions: Segment[][] = [];
    let lastEnd = -Infinity;
    for (const seg of sorted) {
      if (seg.start.getTime() - lastEnd > 90 * 60_000) sessions.push([]);
      sessions[sessions.length - 1].push(seg);
      lastEnd = Math.max(lastEnd, seg.end.getTime());
    }
    for (const ss of sessions) {
      const asleep = ss.filter((x) => x.asleep);
      const minutes = Math.round(mergedMinutes(asleep.length ? asleep : ss)); // older data: "InBed" only
      const bed = new Date(Math.min(...ss.map((x) => x.start.getTime())));
      const wake = new Date(Math.max(...ss.map((x) => x.end.getTime())));
      if (minutes < 120 || wake.getHours() >= 15) continue; // naps and daytime sleep
      const night = { date: toISODate(wake), bedTime: hhmm(bed), wakeTime: hhmm(wake), durationMin: minutes, source, staged: asleep.length > 0 };
      const prev = best.get(night.date);
      if (!prev || (night.staged && !prev.staged) || (night.staged === prev.staged && night.durationMin > prev.durationMin)) best.set(night.date, night);
    }
  }
  return [...best.values()].map(({ staged: _s, ...n }) => n).sort((a, b) => a.date.localeCompare(b.date));
}

/** Total minutes covered by possibly-overlapping segments. */
function mergedMinutes(segs: Segment[]): number {
  const xs = [...segs].sort((a, b) => a.start.getTime() - b.start.getTime());
  let total = 0;
  let curS = 0;
  let curE = 0;
  for (const s of xs) {
    const a = s.start.getTime();
    const b = s.end.getTime();
    if (a > curE) {
      total += curE - curS;
      curS = a;
      curE = b;
    } else curE = Math.max(curE, b);
  }
  total += curE - curS;
  return total / 60_000;
}

/** Read a File as a stream of text chunks (works on large exports without loading them whole). */
export async function scanHealthFile(file: File, onProgress: (fraction: number) => void): Promise<ReturnType<HealthScanner['result']> & { records: number }> {
  const scanner = new HealthScanner();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    scanner.push(decoder.decode(value, { stream: true }));
    onProgress(file.size ? read / file.size : 0);
  }
  scanner.push(decoder.decode());
  return { ...scanner.result(), records: scanner.records };
}
