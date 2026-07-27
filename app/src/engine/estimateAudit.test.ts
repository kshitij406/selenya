/*
 * Estimation-math audit.
 *
 * Every route in the app that turns logged data into a *number a person reads*
 * is exercised here against randomized-but-realistic histories, including the
 * pathological ones that produced "Cycle day 310" and
 * "Next period estimated in 0 days".
 *
 * The generator is seeded, so a failure is always reproducible from the printed
 * scenario. Set AUDIT_REPORT=1 to print a violation report instead of failing,
 * which is how the route inventory below was originally swept.
 */
import { describe, expect, it } from 'vitest'
import type { DailyLog } from '../db/schema'
import {
  addDays,
  averageCycleLength,
  averageFollicularGrowthInDays,
  daysBetween,
  detectBbtShiftEstimates,
  fertileWindow,
  getCycleDay,
  predict,
  predictNextPeriod,
  predictOvulation,
  recalibrateBaseline,
  toEpochDay,
  uncertaintyDays,
  type ISODate,
} from './cycle'
import { buildCycleForecast } from './cycleForecast'
import { analyzePatterns, buildCycleReport, cycleContext, symptomPhaseSummaries } from './patterns'
import { periMonthlyTimeline, periWindowSummary } from './perimenopause'
import { applyPredictionContext, periodTimingStatus } from './predictionContext'
import { pregnancyTimeline, resolvePregnancyDating } from './pregnancyDating'
import {
  bleedingTrend,
  completedCycles,
  cycleWindowStatistics,
  fertilitySignalSeries,
  irregularity,
  periodEpisodeDetails,
  periodEpisodes,
  periSeverityScore,
  symptomFrequency,
  trackingCompleteness,
} from './stats'
import {
  buildTtcOverview,
  fertilityDayGuide,
  pregnancyTestPlan,
  summarizeBbt,
  summarizeOpk,
} from './ttc'
import {
  isForecastAnchorLive,
  LATE_FORECAST_GRACE_DAYS,
  MAX_PLAUSIBLE_CYCLE_DAY,
  STALE_HISTORY_DAYS,
} from './cycle'

/* ------------------------------- generator ------------------------------- */

/** Deterministic 32-bit PRNG (mulberry32) so any failure reproduces exactly. */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const EPOCH_TODAY = '2026-07-26'

interface Scenario {
  name: string
  seed: number
  today: ISODate
  periodStarts: ISODate[]
  ovulations: ISODate[]
  logs: DailyLog[]
  baselineCycleLength?: number
}

type CycleShape =
  | 'regular'
  | 'irregular'
  | 'short'
  | 'long'
  | 'pcos-very-long'
  | 'single-start'
  | 'no-starts'
  | 'stale-abandoned'
  | 'dense-noise'

const SHAPES: CycleShape[] = [
  'regular',
  'irregular',
  'short',
  'long',
  'pcos-very-long',
  'single-start',
  'no-starts',
  'stale-abandoned',
  'dense-noise',
]

function makeScenario(shape: CycleShape, seed: number): Scenario {
  const random = rng(seed)
  const pick = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
  const today = EPOCH_TODAY

  let gaps: number[] = []
  // How long ago tracking *stopped*. This is the dimension that produced the
  // real-world bug: a person logs once, then opens the app ten months later.
  let daysSinceLastStart = pick(0, 34)

  switch (shape) {
    case 'regular':
      gaps = Array.from({ length: pick(3, 8) }, () => pick(27, 29))
      break
    case 'irregular':
      gaps = Array.from({ length: pick(3, 8) }, () => pick(21, 45))
      break
    case 'short':
      gaps = Array.from({ length: pick(3, 8) }, () => pick(19, 23))
      break
    case 'long':
      gaps = Array.from({ length: pick(3, 8) }, () => pick(38, 60))
      daysSinceLastStart = pick(0, 60)
      break
    case 'pcos-very-long':
      gaps = Array.from({ length: pick(2, 5) }, () => pick(60, 160))
      daysSinceLastStart = pick(0, 150)
      break
    case 'single-start':
      gaps = []
      daysSinceLastStart = pick(0, 400)
      break
    case 'no-starts':
      gaps = []
      break
    case 'stale-abandoned':
      gaps = Array.from({ length: pick(2, 5) }, () => pick(26, 31))
      daysSinceLastStart = pick(95, 800)
      break
    case 'dense-noise':
      gaps = Array.from({ length: pick(6, 14) }, () => pick(15, 90))
      break
  }

  const periodStarts: ISODate[] = []
  if (shape !== 'no-starts') {
    let cursor = addDays(today, -daysSinceLastStart)
    periodStarts.unshift(cursor)
    for (let index = gaps.length - 1; index >= 0; index--) {
      cursor = addDays(cursor, -gaps[index])
      periodStarts.unshift(cursor)
    }
  }

  // Flow / symptom / BBT / OPK logs across the covered span.
  const logs: DailyLog[] = []
  const ovulations: ISODate[] = []
  for (const start of periodStarts) {
    const bleedDays = pick(3, 6)
    for (let day = 0; day < bleedDays; day++) {
      logs.push({
        date: addDays(start, day),
        flow: (['light', 'medium', 'heavy', 'clots'] as const)[pick(0, 3)],
        periodStart: day === 0,
        symptoms: random() < 0.5 ? ['Cramps'] : [],
        checkInComplete: random() < 0.6,
      } as DailyLog)
    }
    // A biphasic BBT run mid-cycle, sometimes.
    if (random() < 0.5) {
      const ovDay = pick(11, 18)
      const ovDate = addDays(start, ovDay)
      if (ovDate <= today) {
        for (let offset = -6; offset <= 3; offset++) {
          const date = addDays(ovDate, offset)
          if (date > today) continue
          logs.push({
            date,
            bbt: offset >= 1 ? 3665 + pick(0, 8) : 3630 + pick(0, 6),
            opk: offset === 0 ? 'positive' : offset < 0 ? 'negative' : undefined,
            checkInComplete: true,
            symptoms: random() < 0.3 ? ['Bloating'] : [],
          } as DailyLog)
          ovulations.push(ovDate)
        }
      }
    }
  }

  const uniqueOvulations = [...new Set(ovulations)].sort()
  return {
    name: shape,
    seed,
    today,
    periodStarts,
    ovulations: uniqueOvulations,
    logs: logs.sort((a, b) => a.date.localeCompare(b.date)),
    baselineCycleLength: random() < 0.7 ? pick(21, 35) : undefined,
  }
}

const SCENARIOS: Scenario[] = []
for (const shape of SHAPES) {
  for (let seed = 1; seed <= 40; seed++) SCENARIOS.push(makeScenario(shape, seed * 7919 + shape.length))
}

/* ------------------------------- violations ------------------------------ */

interface Violation {
  route: string
  scenario: string
  seed: number
  detail: string
}

const violations: Violation[] = []

function check(
  condition: boolean,
  route: string,
  scenario: Scenario,
  detail: () => string,
): void {
  if (condition) return
  violations.push({ route, scenario: scenario.name, seed: scenario.seed, detail: detail() })
}

const isISO = (value: unknown): value is ISODate =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

const finiteNumber = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value)

/** Every number a user reads must be finite and not NaN. */
function assertFiniteNumbers(route: string, scenario: Scenario, value: unknown, path = ''): void {
  if (typeof value === 'number') {
    check(Number.isFinite(value), route, scenario, () => `${path} is ${value}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteNumbers(route, scenario, item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertFiniteNumbers(route, scenario, item, path ? `${path}.${key}` : key)
    }
  }
}

/* --------------------------------- audit --------------------------------- */

function auditScenario(scenario: Scenario): void {
  const { periodStarts, ovulations, logs, today, baselineCycleLength } = scenario
  const input = { periodStarts, ovulations, today }
  const opts = { baselineCycleLength }

  /* ---- engine/cycle.ts ---- */
  const avgLength = averageCycleLength(periodStarts)
  assertFiniteNumbers('cycle.averageCycleLength', scenario, avgLength)
  check(avgLength >= 0, 'cycle.averageCycleLength', scenario, () => `negative: ${avgLength}`)

  const growth = averageFollicularGrowthInDays(periodStarts, ovulations)
  assertFiniteNumbers('cycle.averageFollicularGrowthInDays', scenario, growth)
  check(growth >= 0, 'cycle.averageFollicularGrowthInDays', scenario, () => `negative: ${growth}`)

  const band = uncertaintyDays(periodStarts)
  check(
    band >= 2 && band <= 14,
    'cycle.uncertaintyDays',
    scenario,
    () => `band ${band} outside 2..14`,
  )

  const cycleDay = getCycleDay(periodStarts, today, today)
  check(
    cycleDay === null || (cycleDay >= 1 && cycleDay <= MAX_PLAUSIBLE_CYCLE_DAY),
    'cycle.getCycleDay',
    scenario,
    () => `cycleDay ${cycleDay} exceeds plausible bound ${MAX_PLAUSIBLE_CYCLE_DAY}`,
  )

  const nextBasic = predictNextPeriod(input, opts)
  check(
    nextBasic === null || isISO(nextBasic),
    'cycle.predictNextPeriod',
    scenario,
    () => `non-ISO ${String(nextBasic)}`,
  )
  // A live anchor may sit in the past — that is what lets the UI say
  // "your period is N days later than estimated". It may not sit there
  // indefinitely, which is the defect behind "estimated in 0 days".
  check(
    nextBasic === null || isForecastAnchorLive(nextBasic, today, band),
    'cycle.predictNextPeriod',
    scenario,
    () => `expired anchor ${nextBasic}: ${daysBetween(nextBasic!, today)} days past, band ${band}`,
  )

  const ovulation = predictOvulation(input, opts)
  check(
    ovulation === null || isISO(ovulation),
    'cycle.predictOvulation',
    scenario,
    () => `non-ISO ${String(ovulation)}`,
  )

  if (ovulation) {
    const window = fertileWindow(ovulation)
    check(
      toEpochDay(window.start) <= toEpochDay(window.end),
      'cycle.fertileWindow',
      scenario,
      () => `start ${window.start} after end ${window.end}`,
    )
  }

  const rebased = recalibrateBaseline(28, completedCycles(periodStarts).map((c) => c.length))
  check(
    finiteNumber(rebased) && rebased > 0,
    'cycle.recalibrateBaseline',
    scenario,
    () => `bad baseline ${rebased}`,
  )

  const shifts = detectBbtShiftEstimates(
    logs
      .filter((log): log is DailyLog & { bbt: number } => log.bbt !== undefined)
      .map((log) => ({ date: log.date, bbt: log.bbt })),
  )
  check(
    shifts.every(isISO),
    'cycle.detectBbtShiftEstimates',
    scenario,
    () => `non-ISO shift in ${JSON.stringify(shifts)}`,
  )

  const prediction = predict(input, opts)
  assertFiniteNumbers('cycle.predict', scenario, prediction)
  check(
    prediction.cycleDay === null ||
      (prediction.cycleDay >= 1 && prediction.cycleDay <= MAX_PLAUSIBLE_CYCLE_DAY),
    'cycle.predict',
    scenario,
    () => `cycleDay ${prediction.cycleDay}`,
  )
  check(
    prediction.nextPeriodStart === null ||
      isForecastAnchorLive(prediction.nextPeriodStart, today, prediction.uncertaintyDays),
    'cycle.predict',
    scenario,
    () => `expired nextPeriodStart ${prediction.nextPeriodStart} (today ${today})`,
  )

  /* ---- engine/cycleForecast.ts ---- */
  const forecast = buildCycleForecast(input, {
    baselineCycleLength,
    positiveOpkDates: logs.filter((log) => log.opk === 'positive').map((log) => log.date),
    bbtShiftDates: ovulations,
  })
  assertFiniteNumbers('cycleForecast.buildCycleForecast', scenario, forecast.prediction)
  const fp = forecast.prediction
  const fd = forecast.diagnostics

  check(
    fp.cycleDay === null || (fp.cycleDay >= 1 && fp.cycleDay <= MAX_PLAUSIBLE_CYCLE_DAY),
    'cycleForecast.cycleDay',
    scenario,
    () => `cycleDay ${fp.cycleDay} (last start ${periodStarts.at(-1)}, today ${today})`,
  )
  check(
    fp.nextPeriodStart === null ||
      isForecastAnchorLive(fp.nextPeriodStart, today, fp.uncertaintyDays),
    'cycleForecast.nextPeriodStart',
    scenario,
    () =>
      `expired anchor ${fp.nextPeriodStart}: ${daysBetween(
        fp.nextPeriodStart!,
        today,
      )} days past, band ${fp.uncertaintyDays}`,
  )
  check(
    fp.uncertaintyDays >= 2 && fp.uncertaintyDays <= 14,
    'cycleForecast.uncertaintyDays',
    scenario,
    () => `band ${fp.uncertaintyDays}`,
  )
  check(
    fp.averageCycleLength === 0 || (fp.averageCycleLength >= 15 && fp.averageCycleLength <= 90),
    'cycleForecast.averageCycleLength',
    scenario,
    () => `averageCycleLength ${fp.averageCycleLength} outside 15..90`,
  )
  if (fp.fertileWindow) {
    check(
      toEpochDay(fp.fertileWindow.start) <= toEpochDay(fp.fertileWindow.end),
      'cycleForecast.fertileWindow',
      scenario,
      () => `inverted ${fp.fertileWindow!.start}..${fp.fertileWindow!.end}`,
    )
  }
  if (fd.periodWindow && fp.nextPeriodStart) {
    check(
      toEpochDay(fd.periodWindow.start) <= toEpochDay(fp.nextPeriodStart) &&
        toEpochDay(fp.nextPeriodStart) <= toEpochDay(fd.periodWindow.end),
      'cycleForecast.periodWindow',
      scenario,
      () =>
        `point ${fp.nextPeriodStart} outside window ${fd.periodWindow!.start}..${
          fd.periodWindow!.end
        }`,
    )
  }
  if (fd.ovulationWindow) {
    check(
      toEpochDay(fd.ovulationWindow.start) <= toEpochDay(fd.ovulationWindow.end),
      'cycleForecast.ovulationWindow',
      scenario,
      () => `inverted ${fd.ovulationWindow!.start}..${fd.ovulationWindow!.end}`,
    )
  }
  if (fd.fertileWindowRange) {
    check(
      toEpochDay(fd.fertileWindowRange.start) <= toEpochDay(fd.fertileWindowRange.end),
      'cycleForecast.fertileWindowRange',
      scenario,
      () => `inverted ${fd.fertileWindowRange!.start}..${fd.fertileWindowRange!.end}`,
    )
  }
  check(
    fd.includedCycleLengths.every((length) => length >= 15 && length <= 90),
    'cycleForecast.includedCycleLengths',
    scenario,
    () => `out-of-policy interval kept: ${JSON.stringify(fd.includedCycleLengths)}`,
  )
  check(
    fd.completedCycleCount === fd.includedCycleLengths.length,
    'cycleForecast.completedCycleCount',
    scenario,
    () => `count ${fd.completedCycleCount} != ${fd.includedCycleLengths.length}`,
  )

  // A forecast may not be presented as current when the history behind it is stale.
  const lastStart = periodStarts.at(-1)
  if (lastStart && daysBetween(lastStart, today) > STALE_HISTORY_DAYS) {
    check(
      fp.cycleDay === null,
      'cycleForecast.staleHistory',
      scenario,
      () =>
        `cycleDay ${fp.cycleDay} presented from a ${daysBetween(
          lastStart,
          today,
        )}-day-old period start`,
    )
    check(
      fd.forecastAnchor === 'none' || fd.stale === true,
      'cycleForecast.staleHistory',
      scenario,
      () => `stale history not flagged (anchor ${fd.forecastAnchor})`,
    )
  }

  /* ---- engine/predictionContext.ts ---- */
  const profile = {
    primaryGoal: 'cycle',
    cycle: { typicalCycleLength: baselineCycleLength ?? 28, regularity: 'regular', abnormalities: [] },
    reproductive: { contraception: 'none' },
    conditions: [],
  } as never
  const personalized = applyPredictionContext(fp, profile, {
    completedCycles: fd.completedCycleCount,
    bbtShiftEstimateCount: ovulations.length,
    positiveOpkThisCycle: false,
  })
  assertFiniteNumbers('predictionContext.applyPredictionContext', scenario, personalized.prediction)
  check(
    personalized.prediction.uncertaintyDays >= 2 &&
      personalized.prediction.uncertaintyDays <= 14,
    'predictionContext.uncertaintyDays',
    scenario,
    () => `band ${personalized.prediction.uncertaintyDays}`,
  )

  const timing = periodTimingStatus(today, fp.nextPeriodStart, fp.uncertaintyDays)
  check(
    timing.daysBeyondWindow >= 0,
    'predictionContext.periodTimingStatus',
    scenario,
    () => `negative daysBeyondWindow ${timing.daysBeyondWindow}`,
  )
  check(
    timing.daysBeyondWindow <= LATE_FORECAST_GRACE_DAYS,
    'predictionContext.periodTimingStatus',
    scenario,
    () =>
      `daysBeyondWindow ${timing.daysBeyondWindow} exceeds the ${LATE_FORECAST_GRACE_DAYS}-day ` +
      `grace window, so an expired forecast was still shown as "late"`,
  )

  /* ---- engine/stats.ts ---- */
  const cycles = completedCycles(periodStarts)
  assertFiniteNumbers('stats.completedCycles', scenario, cycles)
  check(
    cycles.every((cycle) => cycle.length > 0),
    'stats.completedCycles',
    scenario,
    () => `non-positive cycle length in ${JSON.stringify(cycles)}`,
  )

  assertFiniteNumbers('stats.periodEpisodes', scenario, periodEpisodes(logs.filter((l) => l.flow).map((l) => l.date)))

  for (const window of [6, 12] as const) {
    const stats = cycleWindowStatistics(periodStarts, window)
    assertFiniteNumbers('stats.cycleWindowStatistics', scenario, stats)
    check(
      stats.sampleSize <= window,
      'stats.cycleWindowStatistics',
      scenario,
      () => `sampleSize ${stats.sampleSize} exceeds window ${window}`,
    )
    if (stats.shortestDays !== null && stats.longestDays !== null) {
      check(
        stats.shortestDays <= stats.longestDays,
        'stats.cycleWindowStatistics',
        scenario,
        () => `shortest ${stats.shortestDays} > longest ${stats.longestDays}`,
      )
      check(
        stats.rangeDays === stats.longestDays - stats.shortestDays,
        'stats.cycleWindowStatistics',
        scenario,
        () => `rangeDays mismatch`,
      )
    }
    if (stats.averageDays !== null && stats.shortestDays !== null && stats.longestDays !== null) {
      check(
        stats.averageDays >= stats.shortestDays - 0.05 &&
          stats.averageDays <= stats.longestDays + 0.05,
        'stats.cycleWindowStatistics',
        scenario,
        () => `average ${stats.averageDays} outside [${stats.shortestDays}, ${stats.longestDays}]`,
      )
    }
  }

  const bleeding = bleedingTrend(logs)
  assertFiniteNumbers('stats.bleedingTrend', scenario, bleeding)
  check(
    bleeding.episodes.every((episode) => episode.days >= 1 && episode.knownFlowDays >= 1),
    'stats.bleedingTrend',
    scenario,
    () => `bad episode in ${JSON.stringify(bleeding.episodes)}`,
  )
  check(
    bleeding.episodes.every((episode) => episode.heavyOrClotDays <= episode.knownFlowDays),
    'stats.bleedingTrend',
    scenario,
    () => `heavyOrClotDays exceeds knownFlowDays`,
  )

  assertFiniteNumbers('stats.periodEpisodeDetails', scenario, periodEpisodeDetails(logs))

  const completeness = trackingCompleteness(logs, today)
  assertFiniteNumbers('stats.trackingCompleteness', scenario, completeness)
  check(
    completeness.entryCoveragePercent >= 0 && completeness.entryCoveragePercent <= 100,
    'stats.trackingCompleteness',
    scenario,
    () => `entryCoveragePercent ${completeness.entryCoveragePercent}`,
  )
  check(
    completeness.completeCoveragePercent >= 0 && completeness.completeCoveragePercent <= 100,
    'stats.trackingCompleteness',
    scenario,
    () => `completeCoveragePercent ${completeness.completeCoveragePercent}`,
  )
  check(
    completeness.completeCheckInDays <= completeness.daysWithAnyEntry,
    'stats.trackingCompleteness',
    scenario,
    () => `complete ${completeness.completeCheckInDays} > any ${completeness.daysWithAnyEntry}`,
  )

  const series = fertilitySignalSeries(logs, periodStarts)
  assertFiniteNumbers('stats.fertilitySignalSeries', scenario, series)
  check(
    series.every(
      (point) =>
        point.cycleDay === null ||
        (point.cycleDay >= 1 && point.cycleDay <= MAX_PLAUSIBLE_CYCLE_DAY),
    ),
    'stats.fertilitySignalSeries',
    scenario,
    () =>
      `implausible cycleDay: ${JSON.stringify(
        series.filter((p) => p.cycleDay !== null && p.cycleDay > MAX_PLAUSIBLE_CYCLE_DAY).slice(0, 3),
      )}`,
  )
  check(
    series.every((point) => point.bbtCelsius === undefined || (point.bbtCelsius > 25 && point.bbtCelsius < 45)),
    'stats.fertilitySignalSeries',
    scenario,
    () => `bbtCelsius outside a physiological range`,
  )

  assertFiniteNumbers('stats.symptomFrequency', scenario, symptomFrequency(logs))

  const irregular = irregularity(periodStarts)
  assertFiniteNumbers('stats.irregularity', scenario, irregular)
  check(
    irregular.rangeDays >= 0,
    'stats.irregularity',
    scenario,
    () => `negative rangeDays ${irregular.rangeDays}`,
  )

  const peri = periSeverityScore(logs, ['Cramps', 'Bloating'])
  check(
    peri >= 0 && peri <= 10,
    'stats.periSeverityScore',
    scenario,
    () => `score ${peri} outside 0..10`,
  )

  /* ---- engine/ttc.ts ---- */
  const guide = fertilityDayGuide(today, fp)
  assertFiniteNumbers('ttc.fertilityDayGuide', scenario, guide)
  check(
    guide.relativeDay === null || Math.abs(guide.relativeDay) <= MAX_PLAUSIBLE_CYCLE_DAY,
    'ttc.fertilityDayGuide',
    scenario,
    () => `relativeDay ${guide.relativeDay}`,
  )

  const plan = pregnancyTestPlan(today, fp.ovulationDate, fp.nextPeriodStart)
  check(
    plan.suggestedDate === null || isISO(plan.suggestedDate),
    'ttc.pregnancyTestPlan',
    scenario,
    () => `bad suggestedDate ${String(plan.suggestedDate)}`,
  )
  check(
    plan.suggestedDate === null ||
      isForecastAnchorLive(plan.suggestedDate, today, fp.uncertaintyDays),
    'ttc.pregnancyTestPlan',
    scenario,
    () => `expired suggestedDate ${plan.suggestedDate} relative to today ${today}`,
  )

  const bbt = summarizeBbt(logs, today)
  assertFiniteNumbers('ttc.summarizeBbt', scenario, bbt)
  check(
    bbt.trackingCoverage >= 0 && bbt.trackingCoverage <= 100,
    'ttc.summarizeBbt',
    scenario,
    () => `trackingCoverage ${bbt.trackingCoverage}`,
  )
  check(
    bbt.readingsLast30Days >= 0 && bbt.readingsLast30Days <= 30,
    'ttc.summarizeBbt',
    scenario,
    () => `readingsLast30Days ${bbt.readingsLast30Days} outside 0..30`,
  )

  const opk = summarizeOpk(logs, lastStart ?? null)
  assertFiniteNumbers('ttc.summarizeOpk', scenario, opk)
  check(
    opk.testsThisCycle >= 0,
    'ttc.summarizeOpk',
    scenario,
    () => `negative testsThisCycle`,
  )

  const overview = buildTtcOverview(today, fp, logs)
  assertFiniteNumbers('ttc.buildTtcOverview', scenario, overview)
  check(
    overview.fertileWindowSexDays >= 0 && overview.fertileWindowSexDays <= 31,
    'ttc.buildTtcOverview',
    scenario,
    () => `fertileWindowSexDays ${overview.fertileWindowSexDays}`,
  )
  check(
    overview.prenatalVitaminDaysLast14 >= 0 && overview.prenatalVitaminDaysLast14 <= 14,
    'ttc.buildTtcOverview',
    scenario,
    () => `prenatalVitaminDaysLast14 ${overview.prenatalVitaminDaysLast14}`,
  )

  /* ---- engine/perimenopause.ts ---- */
  const periSummary = periWindowSummary(logs, today)
  assertFiniteNumbers('perimenopause.periWindowSummary', scenario, periSummary)
  check(
    periSummary.score >= 0 && periSummary.score <= 100,
    'perimenopause.periWindowSummary',
    scenario,
    () => `score ${periSummary.score}`,
  )
  check(
    periSummary.trackingCoverage >= 0 && periSummary.trackingCoverage <= 100,
    'perimenopause.periWindowSummary',
    scenario,
    () => `trackingCoverage ${periSummary.trackingCoverage}`,
  )
  check(
    periSummary.domains.every((domain) => domain.score >= 0 && domain.score <= 100),
    'perimenopause.periWindowSummary',
    scenario,
    () => `domain score outside 0..100`,
  )

  const timeline = periMonthlyTimeline(logs, today)
  assertFiniteNumbers('perimenopause.periMonthlyTimeline', scenario, timeline)
  check(
    timeline.every((month) => month.score >= 0 && month.score <= 100),
    'perimenopause.periMonthlyTimeline',
    scenario,
    () => `month score outside 0..100`,
  )

  /* ---- engine/patterns.ts ---- */
  const patterns = analyzePatterns(
    logs.map((log) => ({
      date: log.date,
      checkInComplete: log.checkInComplete,
      symptoms: log.symptoms,
    })),
    periodStarts,
  )
  assertFiniteNumbers('patterns.analyzePatterns', scenario, patterns)
  check(
    patterns.every(
      (pattern) =>
        pattern.evidence.cycleDayRange === undefined ||
        (pattern.evidence.cycleDayRange.start >= 1 &&
          pattern.evidence.cycleDayRange.end <= MAX_PLAUSIBLE_CYCLE_DAY &&
          pattern.evidence.cycleDayRange.start <= pattern.evidence.cycleDayRange.end),
    ),
    'patterns.analyzePatterns',
    scenario,
    () =>
      `implausible cycleDayRange: ${JSON.stringify(
        patterns.map((p) => p.evidence.cycleDayRange).filter(Boolean),
      )}`,
  )

  const context = cycleContext(periodStarts, today)
  check(
    context === null ||
      (context.day >= 1 &&
        context.day <= MAX_PLAUSIBLE_CYCLE_DAY &&
        context.day <= context.length),
    'patterns.cycleContext',
    scenario,
    () => `day ${context?.day} of a ${context?.length}-day cycle`,
  )

  assertFiniteNumbers(
    'patterns.symptomPhaseSummaries',
    scenario,
    symptomPhaseSummaries(
      logs.map((log) => ({
        date: log.date,
        checkInComplete: log.checkInComplete,
        symptoms: log.symptoms,
      })),
      periodStarts,
    ),
  )

  assertFiniteNumbers(
    'patterns.buildCycleReport',
    scenario,
    buildCycleReport(
      logs.map((log) => ({
        date: log.date,
        checkInComplete: log.checkInComplete,
        symptoms: log.symptoms,
      })),
      periodStarts,
      today,
    ),
  )

  /* ---- engine/pregnancyDating.ts ---- */
  if (lastStart) {
    const dating = resolvePregnancyDating({ method: 'lmp', date: lastStart })
    const pregnancy = pregnancyTimeline(dating, today)
    if (pregnancy) {
      assertFiniteNumbers('pregnancyDating.pregnancyTimeline', scenario, pregnancy)
      check(
        pregnancy.week >= 0 && pregnancy.week <= 45,
        'pregnancyDating.pregnancyTimeline',
        scenario,
        () => `week ${pregnancy.week}`,
      )
      check(
        pregnancy.dayOfWeek >= 0 && pregnancy.dayOfWeek <= 6,
        'pregnancyDating.pregnancyTimeline',
        scenario,
        () => `dayOfWeek ${pregnancy.dayOfWeek}`,
      )
      check(
        pregnancy.daysRemaining >= 0,
        'pregnancyDating.pregnancyTimeline',
        scenario,
        () => `daysRemaining ${pregnancy.daysRemaining}`,
      )
    }
  }
}

/* --------------------------------- suite --------------------------------- */

describe('estimation math audit', () => {
  it('holds every user-facing estimate inside its documented bounds', () => {
    violations.length = 0
    for (const scenario of SCENARIOS) auditScenario(scenario)

    const byRoute = new Map<string, Violation[]>()
    for (const violation of violations) {
      byRoute.set(violation.route, [...(byRoute.get(violation.route) ?? []), violation])
    }

    if (byRoute.size > 0) {
      const report = [...byRoute.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([route, items]) => {
          const sample = items[0]
          return `  ${route}: ${items.length} failing scenario(s)\n     e.g. [${sample.scenario} seed=${sample.seed}] ${sample.detail}`
        })
        .join('\n')
      throw new Error(
        `${violations.length} estimation violations across ${byRoute.size} route(s) ` +
          `over ${SCENARIOS.length} scenarios:\n${report}`,
      )
    }

    expect(violations).toHaveLength(0)
  })

  it('covers the pathological histories that produced the reported bugs', () => {
    // Reported: a single period start logged ~10 months ago rendered as
    // "Cycle day 310" with "Next period estimated in 0 days".
    const today = '2026-07-26'
    const staleStart = '2025-09-20'
    const forecast = buildCycleForecast(
      { periodStarts: [staleStart], ovulations: [], today },
      { baselineCycleLength: 28 },
    )

    expect(daysBetween(staleStart, today)).toBe(309)
    expect(forecast.prediction.cycleDay).toBeNull()
    expect(forecast.diagnostics.stale).toBe(true)
    expect(
      forecast.prediction.nextPeriodStart === null ||
        forecast.prediction.nextPeriodStart >= today,
    ).toBe(true)
  })
})
