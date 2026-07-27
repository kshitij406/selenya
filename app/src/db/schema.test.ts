import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeContraceptionRegimen,
  addContraceptionRegimen,
  createDefaultHealthProfile,
  dailyLogHasEntry,
  db,
  deleteContraceptionRegimen,
  getContraceptionRegimens,
  getHealthProfile,
  normalizeDailyLog,
  normalizeHealthProfile,
  SK,
  updateContraceptionRegimen,
  type ContraceptionRegimenEntry,
} from './schema'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HealthProfile normalization', () => {
  it('creates a complete versioned primary profile', () => {
    const profile = createDefaultHealthProfile('2026-07-26T12:00:00.000Z')

    expect(profile).toMatchObject({
      id: 'primary',
      schemaVersion: 2,
      createdAt: '2026-07-26T12:00:00.000Z',
      primaryGoal: 'cycle',
      goals: ['cycle'],
      cycle: {
        regularity: 'unsure',
        dateConfidence: 'unknown',
        abnormalities: [],
      },
      reproductive: { contraception: 'unknown' },
      permissions: {
        motionFitness: 'not-requested',
        healthData: 'not-requested',
        notifications: 'not-requested',
      },
      privacy: {
        ageBand: 'unknown',
        minimumAgeConfirmed: false,
        localOnly: true,
        onboardingVersion: 2,
        consentLedger: [],
      },
    })
  })

  it('deep-merges old partial records and keeps primary goal inside goals', () => {
    const profile = normalizeHealthProfile(
      {
        primaryGoal: 'ttc',
        goals: ['cycle'],
        displayName: 'Sam',
        cycle: {
          regularity: 'irregular',
          typicalCycleLength: 34,
        },
        wellbeing: {
          sleepGoals: ['wake-rested'],
        },
      },
      '2026-07-26T12:00:00.000Z',
    )

    expect(profile.goals).toEqual(['ttc', 'cycle'])
    expect(profile.cycle).toMatchObject({
      regularity: 'irregular',
      typicalCycleLength: 34,
      dateConfidence: 'unknown',
      baselineSymptoms: [],
    })
    expect(profile.wellbeing).toMatchObject({
      sleepGoals: ['wake-rested'],
      activityLevel: 'unknown',
      wearable: 'unknown',
      mentalHealthSignals: [],
    })
    expect(profile.privacy).toMatchObject({
      ageBand: 'unknown',
      localOnly: true,
      consentLedger: [],
    })
  })

  it('derives a missing profile without writing inside reactive read contexts', async () => {
    vi.spyOn(db.healthProfiles, 'get').mockResolvedValue(undefined)
    vi.spyOn(db.settings, 'toArray').mockResolvedValue([
      { key: SK.goal, value: 'ttc' },
      { key: SK.cycleLength, value: '31' },
    ])
    const put = vi.spyOn(db.healthProfiles, 'put')

    const profile = await getHealthProfile()

    expect(profile.primaryGoal).toBe('ttc')
    expect(profile.cycle.typicalCycleLength).toBe(31)
    expect(put).not.toHaveBeenCalled()
  })
})

describe('DailyLog compatibility and coverage', () => {
  it('reads the legacy single-value intimacy field through the richer collection', () => {
    expect(
      normalizeDailyLog({
        date: '2026-07-26',
        sex: 'protected',
      }),
    ).toMatchObject({
      sex: 'protected',
      intimacyEvents: ['protected'],
    })
  })

  it('respects an explicitly cleared canonical intimacy collection', () => {
    expect(
      normalizeDailyLog({
        date: '2026-07-26',
        sex: 'protected',
        intimacyEvents: [],
      }).intimacyEvents,
    ).toEqual([])
  })

  it('keeps an explicitly complete symptom-free check-in but ignores an untouched draft', () => {
    expect(dailyLogHasEntry({ date: '2026-07-26' })).toBe(false)
    expect(dailyLogHasEntry({ date: '2026-07-26', checkInComplete: true })).toBe(true)
  })

  it('recognizes every new structured observation family as a real entry', () => {
    expect(
      dailyLogHasEntry({
        date: '2026-07-26',
        symptomRatings: { Cramps: { severity: 'moderate', impairment: 'noticeable' } },
      }),
    ).toBe(true)
    expect(dailyLogHasEntry({ date: '2026-07-26', pregnancyTest: 'negative' })).toBe(true)
    expect(dailyLogHasEntry({ date: '2026-07-26', digestion: ['bloating'] })).toBe(true)
    expect(dailyLogHasEntry({ date: '2026-07-26', activities: ['walking'] })).toBe(true)
    expect(dailyLogHasEntry({ date: '2026-07-26', lifestyle: ['travel'] })).toBe(true)
  })
})

describe('contraception regimen history', () => {
  it('generates an id and timestamps when adding a regimen', async () => {
    const put = vi.spyOn(db.contraceptionRegimens, 'put').mockResolvedValue('' as never)

    const entry = await addContraceptionRegimen({ method: 'copper-iud', startDate: '2024-01-01' })

    expect(entry.id).toBeTruthy()
    expect(entry.createdAt).toBe(entry.updatedAt)
    expect(put).toHaveBeenCalledWith(entry)
  })

  it('lists regimens most-recently-started first', async () => {
    vi.spyOn(db.contraceptionRegimens, 'toArray').mockResolvedValue([
      { id: 'old', method: 'copper-iud', startDate: '2024-01-01', createdAt: '', updatedAt: '' },
      {
        id: 'new',
        method: 'combined-pill-patch-ring',
        startDate: '2026-01-01',
        createdAt: '',
        updatedAt: '',
      },
    ])

    const all = await getContraceptionRegimens()
    expect(all.map((entry) => entry.id)).toEqual(['new', 'old'])
  })

  it('merges a patch onto the existing entry and refreshes updatedAt', async () => {
    const existing: ContraceptionRegimenEntry = {
      id: 'x',
      method: 'injection',
      startDate: '2026-01-01',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    vi.spyOn(db.contraceptionRegimens, 'get').mockResolvedValue(existing)
    const put = vi.spyOn(db.contraceptionRegimens, 'put').mockResolvedValue('' as never)

    await updateContraceptionRegimen('x', { endDate: '2026-04-01' })

    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'x', endDate: '2026-04-01', createdAt: existing.createdAt }),
    )
    expect(put.mock.calls[0][0].updatedAt).not.toBe(existing.updatedAt)
  })

  it('deletes a regimen by id', async () => {
    const del = vi.spyOn(db.contraceptionRegimens, 'delete').mockResolvedValue(undefined)
    await deleteContraceptionRegimen('x')
    expect(del).toHaveBeenCalledWith('x')
  })

  it('finds the regimen active on a given date, including open-ended entries', () => {
    const entries: ContraceptionRegimenEntry[] = [
      {
        id: 'a',
        method: 'copper-iud',
        startDate: '2024-01-01',
        endDate: '2025-06-01',
        createdAt: '',
        updatedAt: '',
      },
      { id: 'b', method: 'implant', startDate: '2025-06-02', createdAt: '', updatedAt: '' },
    ]

    expect(activeContraceptionRegimen(entries, '2024-06-01')?.id).toBe('a')
    expect(activeContraceptionRegimen(entries, '2026-01-01')?.id).toBe('b')
    expect(activeContraceptionRegimen(entries, '2025-06-01')?.id).toBe('a')
    expect(activeContraceptionRegimen(entries, '2020-01-01')).toBeUndefined()
  })
})
