import { describe, expect, it } from 'vitest'
import {
  averageCycleLength,
  averageFollicularGrowthInDays,
  fertileWindow,
  getCycleDay,
  predict,
  predictNextPeriod,
  predictOvulation,
  recalibrateBaseline,
  uncertaintyDays,
  detectBbtShiftEstimates,
} from './cycle'

const TODAY = '2026-02-10'

describe('predictNextPeriod (Mensinator port)', () => {
  // Parity with upstream PeriodPredictionTest: one period → null.
  it('returns null with fewer than 2 periods', () => {
    expect(predictNextPeriod({ periodStarts: ['2026-01-01'], ovulations: [], today: TODAY })).toBeNull()
    expect(predictNextPeriod({ periodStarts: [], ovulations: [], today: TODAY })).toBeNull()
  })

  it('can use a user-entered baseline without inventing a historical period', () => {
    expect(
      predictNextPeriod(
        { periodStarts: ['2026-01-01'], ovulations: [], today: TODAY },
        { baselineCycleLength: 30 },
      ),
    ).toBe('2026-01-31')
  })

  it('predicts last start + average cycle length for regular cycles', () => {
    const input = { periodStarts: ['2026-01-01', '2026-01-29', '2026-02-26'], ovulations: [], today: TODAY }
    expect(predictNextPeriod(input)).toBe('2026-03-26')
  })

  it('truncates fractional averages like the Kotlin source (29,28 → 28)', () => {
    const input = { periodStarts: ['2026-01-01', '2026-01-30', '2026-02-27'], ovulations: [], today: TODAY }
    // diffs 29, 28 → avg 28.5 → trunc 28
    expect(predictNextPeriod(input)).toBe('2026-03-27')
  })

  it('uses only the configured history window', () => {
    // Old erratic cycles fall outside periodHistory=2 (last 3 starts).
    const input = {
      periodStarts: ['2025-06-01', '2025-07-20', '2026-01-01', '2026-01-29', '2026-02-26'],
      ovulations: [],
      today: TODAY,
    }
    expect(predictNextPeriod(input, { periodHistory: 2 })).toBe('2026-03-26')
  })
})

describe('luteal-mode prediction (Mensinator advanced port)', () => {
  it('anchors on last ovulation + average luteal length', () => {
    const input = {
      periodStarts: ['2026-01-01', '2026-01-29'],
      ovulations: ['2026-01-15', '2026-02-12'],
      today: TODAY,
    }
    // Luteal from 01-15 → 01-29 = 14; last ovulation 02-12 after last period → 02-12 + 14
    expect(predictNextPeriod(input, { useLutealCalculation: true })).toBe('2026-02-26')
  })

  it('re-anchors on expected ovulation when a period started after the last ovulation', () => {
    const input = {
      periodStarts: ['2026-01-01', '2026-01-29'],
      ovulations: ['2026-01-15'],
      today: TODAY,
    }
    // follicular 14 → expected ovulation 01-29+14 = 02-12; luteal 14 → 02-26
    expect(predictNextPeriod(input, { useLutealCalculation: true })).toBe('2026-02-26')
  })

  it('averages helpers agree with hand math', () => {
    const periodStarts = ['2026-01-01', '2026-01-29']
    const ovulations = ['2026-01-15']
    expect(averageFollicularGrowthInDays(periodStarts, ovulations)).toBe(14)
    expect(averageCycleLength(periodStarts)).toBe(28)
  })
})

describe('predictOvulation', () => {
  it('ports the >=2-ovulation path (ovulation before last period start)', () => {
    const input = {
      periodStarts: ['2026-01-01', '2026-01-29'],
      ovulations: ['2025-12-18', '2026-01-15'],
      today: TODAY,
    }
    // follicular growth: 01-15 from 01-01 = 14 (12-18 has no prior period logged)
    // last ovulation < last period start → last period start + 14
    expect(predictOvulation(input)).toBe('2026-02-12')
  })

  it('EXTENSION: falls back to predicted period − 14 without ovulation data', () => {
    const input = { periodStarts: ['2026-01-01', '2026-01-29'], ovulations: [], today: TODAY }
    // next period 02-26 → ovulation estimate 02-12
    expect(predictOvulation(input)).toBe('2026-02-12')
  })

  it('returns null when nothing is predictable', () => {
    expect(predictOvulation({ periodStarts: ['2026-01-01'], ovulations: [], today: TODAY })).toBeNull()
  })
})

describe('getCycleDay', () => {
  const periodStarts = ['2026-01-01', '2026-01-29']
  it('is 1-based from the last period start', () => {
    expect(getCycleDay(periodStarts, '2026-01-29', TODAY)).toBe(1)
    expect(getCycleDay(periodStarts, '2026-02-10', TODAY)).toBe(13)
  })
  it('refuses future dates and pre-history dates', () => {
    expect(getCycleDay(periodStarts, '2026-02-11', TODAY)).toBeNull()
    expect(getCycleDay(periodStarts, '2025-12-31', TODAY)).toBeNull()
  })
})

describe('EXTENSION: uncertainty band', () => {
  it('stays wide (±5) with fewer than 3 completed cycles', () => {
    expect(uncertaintyDays(['2026-01-01', '2026-01-29'])).toBe(5)
  })
  it('tightens for regular cycles and widens for irregular ones', () => {
    const regular = ['2025-11-05', '2025-12-03', '2025-12-31', '2026-01-28']
    const irregular = ['2025-11-05', '2025-11-30', '2026-01-04', '2026-02-01']
    expect(uncertaintyDays(regular)).toBe(2)
    expect(uncertaintyDays(irregular)).toBeGreaterThan(uncertaintyDays(regular))
  })
})

describe('EXTENSION: baseline recalibration (3-consecutive-cycle rule)', () => {
  it('holds the baseline on a single anomaly', () => {
    expect(recalibrateBaseline(28, [28, 28, 35])).toBe(28)
  })
  it('shifts only after 3 consecutive deviations', () => {
    expect(recalibrateBaseline(28, [32, 33, 31])).toBe(32)
  })
  it('needs 3 data points', () => {
    expect(recalibrateBaseline(28, [35, 34])).toBe(28)
  })
})

describe('predict() summary', () => {
  it('assembles the full picture for a regular tracker', () => {
    const p = predict({
      periodStarts: ['2025-12-04', '2026-01-01', '2026-01-29'],
      ovulations: [],
      today: TODAY,
    })
    expect(p.nextPeriodStart).toBe('2026-02-26')
    expect(p.ovulationDate).toBe('2026-02-12')
    expect(p.fertileWindow).toEqual({ start: '2026-02-07', end: '2026-02-12' })
    expect(p.cycleDay).toBe(13)
    expect(p.averageCycleLength).toBe(28)
    expect(p.source).toBe('basic')
  })

  it('reports insufficient data honestly', () => {
    const p = predict({ periodStarts: ['2026-01-01'], ovulations: [], today: TODAY })
    expect(p.nextPeriodStart).toBeNull()
    expect(p.averageCycleLength).toBe(0)
    expect(p.source).toBe('insufficient-data')
  })

  it('labels a one-period baseline estimate separately from observed history', () => {
    const p = predict(
      { periodStarts: ['2026-01-15'], ovulations: [], today: TODAY },
      { baselineCycleLength: 29 },
    )
    expect(p.nextPeriodStart).toBe('2026-02-13')
    expect(p.averageCycleLength).toBe(29)
    expect(p.source).toBe('baseline')
  })

  it('auto-selects luteal mode once 2+ ovulations are logged', () => {
    const p = predict({
      periodStarts: ['2026-01-01', '2026-01-29'],
      ovulations: ['2026-01-15', '2026-02-12'],
      today: TODAY,
    })
    expect(p.source).toBe('luteal')
    expect(p.nextPeriodStart).toBe('2026-02-26')
  })

  it('uses the six-day biological fertile window from O−5 through O', () => {
    expect(fertileWindow('2026-02-12')).toEqual({ start: '2026-02-07', end: '2026-02-12' })
  })
})

describe('detectBbtShiftEstimates', () => {
  it('estimates the day before a sustained temperature shift without claiming confirmation', () => {
    const readings = [
      ['2026-01-08', 3630],
      ['2026-01-09', 3640],
      ['2026-01-10', 3625],
      ['2026-01-11', 3635],
      ['2026-01-12', 3630],
      ['2026-01-13', 3640],
      ['2026-01-14', 3665],
      ['2026-01-15', 3670],
      ['2026-01-16', 3680],
    ].map(([date, bbt]) => ({ date: String(date), bbt: Number(bbt) }))
    expect(detectBbtShiftEstimates(readings)).toEqual(['2026-01-13'])
  })

  it('ignores a single temperature spike', () => {
    const readings = [
      ['2026-01-08', 3630],
      ['2026-01-09', 3640],
      ['2026-01-10', 3625],
      ['2026-01-11', 3635],
      ['2026-01-12', 3680],
      ['2026-01-13', 3630],
      ['2026-01-14', 3640],
    ].map(([date, bbt]) => ({ date: String(date), bbt: Number(bbt) }))
    expect(detectBbtShiftEstimates(readings)).toEqual([])
  })

  it('does not infer a shift from a sparse baseline', () => {
    const readings = [
      ['2025-11-01', 3630],
      ['2025-12-01', 3640],
      ['2026-01-01', 3625],
      ['2026-01-12', 3635],
      ['2026-01-14', 3665],
      ['2026-01-15', 3670],
      ['2026-01-16', 3680],
    ].map(([date, bbt]) => ({ date: String(date), bbt: Number(bbt) }))
    expect(detectBbtShiftEstimates(readings)).toEqual([])
  })
})
