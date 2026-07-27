import { describe, expect, it } from 'vitest'
import type { DailyLog } from '../db/schema'
import type { Prediction } from './cycle'
import {
  buildTtcOverview,
  fertilityDayGuide,
  pregnancyTestPlan,
  summarizeBbt,
  summarizeOpk,
} from './ttc'

const PREDICTION: Prediction = {
  nextPeriodStart: '2026-03-29',
  ovulationDate: '2026-03-15',
  fertileWindow: { start: '2026-03-10', end: '2026-03-15' },
  uncertaintyDays: 2,
  cycleDay: 14,
  averageCycleLength: 28,
  source: 'basic',
}

describe('fertilityDayGuide', () => {
  it('uses qualitative bands and preserves uncertainty', () => {
    expect(fertilityDayGuide('2026-03-13', PREDICTION)).toMatchObject({
      band: 'higher',
      relativeDay: -2,
    })
    expect(fertilityDayGuide('2026-03-10', PREDICTION).band).toBe('possible')
    expect(fertilityDayGuide('2026-03-16', PREDICTION).band).toBe('lower-estimate')
    expect(fertilityDayGuide('2026-03-20', PREDICTION)).toMatchObject({
      band: 'lower-estimate',
      relativeDay: 5,
    })
  })

  it('is honest when dates cannot be estimated', () => {
    expect(fertilityDayGuide('2026-03-13', { ovulationDate: null, fertileWindow: null }).band).toBe(
      'unknown',
    )
  })
})

describe('pregnancyTestPlan', () => {
  it('uses the expected-period marker without inventing an O+10 promise', () => {
    expect(pregnancyTestPlan('2026-03-24', '2026-03-15', '2026-03-29')).toMatchObject({
      suggestedDate: '2026-03-29',
      status: 'wait',
    })
    expect(pregnancyTestPlan('2026-03-27', '2026-03-15', '2026-03-29').status).toBe('wait')
    expect(pregnancyTestPlan('2026-03-29', '2026-03-15', '2026-03-29').status).toBe(
      'test-window',
    )
  })
})

describe('fertility observations', () => {
  const bbtLogs: DailyLog[] = [
    ['2026-03-08', 3630],
    ['2026-03-09', 3640],
    ['2026-03-10', 3625],
    ['2026-03-11', 3635],
    ['2026-03-12', 3630],
    ['2026-03-13', 3640],
    ['2026-03-14', 3665],
    ['2026-03-15', 3670],
    ['2026-03-16', 3680],
  ].map(([date, bbt]) => ({ date: String(date), bbt: Number(bbt) }))

  it('summarizes BBT shifts as retrospective evidence', () => {
    const result = summarizeBbt(bbtLogs, '2026-03-20')
    expect(result.status).toBe('shift-found')
    expect(result.latestShiftEstimate).toBe('2026-03-13')
    expect(result.explanation).toContain('retrospect')
  })

  it('summarizes OPKs without claiming confirmed ovulation', () => {
    const result = summarizeOpk(
      [
        { date: '2026-03-12', opk: 'negative' },
        { date: '2026-03-14', opk: 'positive' },
      ],
      '2026-03-01',
    )
    expect(result.likelyWindow).toEqual({ start: '2026-03-14', end: '2026-03-16' })
    expect(result.explanation).toContain('does not confirm')
  })

  it('builds one local overview from logs and predictions', () => {
    const overview = buildTtcOverview(
      '2026-03-15',
      PREDICTION,
      [
        ...bbtLogs,
        { date: '2026-03-12', sex: 'unprotected', events: ['Prenatal vitamin'] },
        { date: '2026-03-14', opk: 'positive', events: ['Prenatal vitamin'] },
      ],
    )
    expect(overview.day.band).toBe('higher')
    expect(overview.fertileWindowSexDays).toBe(1)
    expect(overview.prenatalVitaminDaysLast14).toBe(2)
  })
})
