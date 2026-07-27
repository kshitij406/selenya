import { describe, expect, it } from 'vitest'
import { gestation } from './pregnancy'
import {
  bleedingTrend,
  completedCycles,
  cycleWindowStatistics,
  fertilitySignalSeries,
  irregularity,
  periSeverityScore,
  periodEpisodes,
  symptomFrequency,
  trackingCompleteness,
} from './stats'

describe('stats', () => {
  it('completedCycles pairs consecutive starts', () => {
    expect(completedCycles(['2026-01-01', '2026-01-29', '2026-02-27'])).toEqual([
      { start: '2026-01-01', length: 28 },
      { start: '2026-01-29', length: 29 },
    ])
  })

  it('periodEpisodes groups consecutive flow days', () => {
    expect(
      periodEpisodes(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-29', '2026-01-30']),
    ).toEqual([
      { start: '2026-01-01', days: 3 },
      { start: '2026-01-29', days: 2 },
    ])
  })

  it('symptomFrequency counts and sorts', () => {
    const logs = [
      { symptoms: ['Cramps', 'Headache'] },
      { symptoms: ['Cramps'], moods: ['Anxious'] },
      { symptoms: ['Cramps'] },
    ]
    expect(symptomFrequency(logs)[0]).toEqual({ name: 'Cramps', count: 3 })
  })

  it('irregularity classifies by recent range', () => {
    expect(irregularity(['2026-01-01', '2026-01-29']).classification).toBe('insufficient-data')
    const regular = ['2025-10-01', '2025-10-29', '2025-11-26', '2025-12-24', '2026-01-21']
    expect(irregularity(regular).classification).toBe('regular')
    const irregularStarts = ['2025-10-01', '2025-10-24', '2025-11-28', '2025-12-24', '2026-01-30']
    expect(irregularity(irregularStarts).classification).toBe('irregular')
  })

  it('periSeverityScore is the share of symptom-days scaled to 10', () => {
    const logs = [
      { symptoms: ['Hot flashes'] },
      { symptoms: ['Cramps'] },
      {},
      { moods: ['Mood swings'] },
    ]
    expect(periSeverityScore(logs, ['Hot flashes', 'Night sweats', 'Mood swings'])).toBe(5)
    expect(periSeverityScore([], ['Hot flashes'])).toBe(0)
  })

  it('builds explainable six and twelve-cycle windows from completed cycles', () => {
    const starts = [
      '2025-11-01',
      '2025-11-29',
      '2025-12-28',
      '2026-01-28',
      '2026-02-28',
      '2026-04-01',
      '2026-05-04',
    ]
    const six = cycleWindowStatistics(starts, 6)
    expect(six.sampleSize).toBe(6)
    expect(six.averageDays).toBe(30.7)
    expect(six.medianDays).toBe(31)
    expect(six.trendDirection).toBe('longer')
    expect(six.methodology).toContain('not a forecast')
  })

  it('summarizes period length and flow without filling missing dates', () => {
    const trend = bleedingTrend([
      { date: '2026-01-01', flow: 'light' },
      { date: '2026-01-02', flow: 'heavy' },
      { date: '2026-01-04', flow: 'light' },
      { date: '2026-01-29', flow: 'medium' },
      { date: '2026-01-30', flow: 'clots' },
    ])
    expect(trend.episodes).toMatchObject([
      { start: '2026-01-01', days: 2, heaviestFlow: 'heavy', heavyOrClotDays: 1 },
      { start: '2026-01-04', days: 1, heaviestFlow: 'light' },
      { start: '2026-01-29', days: 2, heaviestFlow: 'clots', heavyOrClotDays: 1 },
    ])
    expect(trend.methodology).toContain('Missing flow dates')
  })

  it('separates saved-entry coverage from complete check-ins', () => {
    const completeness = trackingCompleteness(
      [
        { date: '2026-03-28', checkInComplete: true },
        { date: '2026-03-29' },
        { date: '2026-03-30', checkInComplete: true },
      ],
      '2026-03-30',
      10,
    )
    expect(completeness.daysWithAnyEntry).toBe(3)
    expect(completeness.completeCheckInDays).toBe(2)
    expect(completeness.entryCoveragePercent).toBe(30)
    expect(completeness.completeCoveragePercent).toBe(20)
  })

  it('plots BBT and OPK as observations without claiming confirmation', () => {
    expect(
      fertilitySignalSeries(
        [
          { date: '2026-01-12', bbt: 3654 },
          { date: '2026-01-13', opk: 'positive' },
        ],
        ['2026-01-01'],
      ),
    ).toEqual([
      {
        date: '2026-01-12',
        cycleStart: '2026-01-01',
        cycleDay: 12,
        bbtCelsius: 36.54,
        opk: undefined,
      },
      {
        date: '2026-01-13',
        cycleStart: '2026-01-01',
        cycleDay: 13,
        bbtCelsius: undefined,
        opk: 'positive',
      },
    ])
  })

})

describe('gestation', () => {
  it('computes week, trimester, and due date from LMP', () => {
    const g = gestation('2026-01-01', '2026-04-09') // 98 days = exactly 14 weeks
    expect(g).not.toBeNull()
    expect(g!.week).toBe(14)
    expect(g!.dayOfWeek).toBe(0)
    expect(g!.trimester).toBe(2)
    expect(g!.dueDate).toBe('2026-10-08')
    expect(g!.daysRemaining).toBe(182)
  })

  it('rejects impossible LMPs', () => {
    expect(gestation('2026-05-01', '2026-04-09')).toBeNull() // future LMP
    expect(gestation('2024-01-01', '2026-04-09')).toBeNull() // way past term
  })

  it('uses standard trimester boundaries', () => {
    expect(gestation('2026-01-01', '2026-04-02')?.trimester).toBe(1) // 13w0d
    expect(gestation('2026-01-01', '2026-04-09')?.trimester).toBe(2) // 14w0d
    expect(gestation('2026-01-01', '2026-07-16')?.trimester).toBe(3) // 28w0d
  })
})
