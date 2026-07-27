import { addDays, daysBetween, toEpochDay, type ISODate } from '../engine/cycle'

/**
 * Report date-range selection.
 *
 * A clinician usually wants a bounded window ("the last six months"), not
 * everything ever logged. Ranges are resolved to explicit inclusive bounds so
 * the exported document can state exactly what it covers — a report that does
 * not name its own window is not interpretable.
 */

export type RangePresetId = 'last-30-days' | 'last-3-months' | 'last-6-months' | 'last-12-months' | 'all' | 'custom'

export interface DateRange {
  start: ISODate
  end: ISODate
}

export interface RangePreset {
  id: RangePresetId
  label: string
  /** Days back from today, inclusive of today. Undefined for 'all'/'custom'. */
  days?: number
}

export const RANGE_PRESETS: RangePreset[] = [
  { id: 'last-30-days', label: '30 days', days: 30 },
  { id: 'last-3-months', label: '3 months', days: 90 },
  { id: 'last-6-months', label: '6 months', days: 182 },
  { id: 'last-12-months', label: '12 months', days: 365 },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
]

export const DEFAULT_RANGE_PRESET: RangePresetId = 'last-6-months'

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_PATTERN.test(value)) return false
  return Number.isFinite(toEpochDay(value))
}

/** Order the bounds and never let a range end in the future. */
export function normalizeRange(start: ISODate, end: ISODate, today: ISODate): DateRange {
  const [low, high] = toEpochDay(start) <= toEpochDay(end) ? [start, end] : [end, start]
  const cappedEnd = toEpochDay(high) > toEpochDay(today) ? today : high
  // Capping the end can invert a range that sat entirely in the future.
  const cappedStart = toEpochDay(low) > toEpochDay(cappedEnd) ? cappedEnd : low
  return { start: cappedStart, end: cappedEnd }
}

/**
 * Resolve a preset to concrete bounds.
 *
 * 'all' spans from the earliest dated entry; with no entries it collapses to
 * today so downstream filters stay well-defined rather than unbounded.
 */
export function resolveRange({
  preset,
  today,
  custom,
  earliestEntry,
}: {
  preset: RangePresetId
  today: ISODate
  custom?: Partial<DateRange>
  earliestEntry?: ISODate | null
}): DateRange {
  if (preset === 'custom') {
    const start = isISODate(custom?.start) ? custom.start : addDays(today, -29)
    const end = isISODate(custom?.end) ? custom.end : today
    return normalizeRange(start, end, today)
  }
  if (preset === 'all') {
    const start = isISODate(earliestEntry) ? earliestEntry : today
    return normalizeRange(start, today, today)
  }
  const days = RANGE_PRESETS.find((item) => item.id === preset)?.days ?? 182
  return normalizeRange(addDays(today, -(days - 1)), today, today)
}

/** Inclusive day count. A single-day range is 1, never 0. */
export function rangeLengthDays(range: DateRange): number {
  return daysBetween(range.start, range.end) + 1
}

export function isWithinRange(date: ISODate, range: DateRange): boolean {
  const epoch = toEpochDay(date)
  return epoch >= toEpochDay(range.start) && epoch <= toEpochDay(range.end)
}

export function filterByRange<T extends { date: ISODate }>(items: T[], range: DateRange): T[] {
  return items.filter((item) => isWithinRange(item.date, range))
}

export function filterDatesByRange(dates: ISODate[], range: DateRange): ISODate[] {
  return dates.filter((date) => isWithinRange(date, range))
}

/** Human-readable span for the report header, e.g. "Jan 3 – Jul 26, 2026 (205 days)". */
export function describeRange(range: DateRange): string {
  const format = (iso: ISODate, withYear: boolean) => {
    const [year, month, day] = iso.split('-').map(Number)
    // Fixed locale, not `undefined`/host locale: this string lands in a
    // doctor-facing PDF and must render the same regardless of device settings.
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    })
  }
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4)
  const days = rangeLengthDays(range)
  if (range.start === range.end) return `${format(range.start, true)} (1 day)`
  return `${format(range.start, !sameYear)} – ${format(range.end, true)} (${days} days)`
}
