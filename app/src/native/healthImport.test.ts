import { afterEach, describe, expect, it, vi } from 'vitest'
import { db, type DailyLog } from '../db/schema'
import { clearHealthImports } from './healthImport'

afterEach(() => {
  vi.restoreAllMocks()
})

/** `applyHealthSamples`/`clearHealthImports` wrap their writes in `db.transaction(...)`; run the callback directly against the mocked table methods instead of opening a real IndexedDB transaction. */
function mockPassthroughTransaction() {
  vi.spyOn(db, 'transaction').mockImplementation(
    (async (...args: unknown[]) => (args[2] as () => Promise<unknown>)()) as unknown as typeof db.transaction,
  )
}

describe('clearHealthImports', () => {
  it('strips only import-sourced fields, leaving manually entered fields untouched', async () => {
    const logs: DailyLog[] = [
      {
        date: '2026-07-01',
        flow: 'medium',
        weightKg: 6200,
        healthImports: {
          flow: { provider: 'apple-health', sampleIds: ['a'], importedAt: '2026-07-01T00:00:00.000Z' },
        },
      },
      { date: '2026-07-02', notes: 'no imports here' },
    ]
    mockPassthroughTransaction()
    vi.spyOn(db.dailyLogs, 'toArray').mockResolvedValue(logs)
    const put = vi.spyOn(db.dailyLogs, 'put').mockResolvedValue('' as never)

    const result = await clearHealthImports()

    expect(result).toEqual({ daysChanged: 1, fieldsCleared: 1 })
    expect(put).toHaveBeenCalledOnce()
    const written = put.mock.calls[0][0] as DailyLog
    expect(written.flow).toBeUndefined()
    expect(written.healthImports).toBeUndefined()
    expect(written.weightKg).toBe(6200)
  })

  it('only clears fields matching the given provider', async () => {
    const logs: DailyLog[] = [
      {
        date: '2026-07-01',
        flow: 'medium',
        bbt: 3670,
        healthImports: {
          flow: { provider: 'apple-health', sampleIds: ['a'], importedAt: '2026-07-01T00:00:00.000Z' },
          bbt: { provider: 'health-connect', sampleIds: ['b'], importedAt: '2026-07-01T00:00:00.000Z' },
        },
      },
    ]
    mockPassthroughTransaction()
    vi.spyOn(db.dailyLogs, 'toArray').mockResolvedValue(logs)
    const put = vi.spyOn(db.dailyLogs, 'put').mockResolvedValue('' as never)

    await clearHealthImports('apple-health')

    const written = put.mock.calls[0][0] as DailyLog
    expect(written.flow).toBeUndefined()
    expect(written.bbt).toBe(3670)
    expect(written.healthImports?.bbt?.provider).toBe('health-connect')
  })

  it('does nothing when no logs carry import provenance', async () => {
    mockPassthroughTransaction()
    vi.spyOn(db.dailyLogs, 'toArray').mockResolvedValue([{ date: '2026-07-01', flow: 'light' }])
    const put = vi.spyOn(db.dailyLogs, 'put').mockResolvedValue('' as never)

    expect(await clearHealthImports()).toEqual({ daysChanged: 0, fieldsCleared: 0 })
    expect(put).not.toHaveBeenCalled()
  })
})
