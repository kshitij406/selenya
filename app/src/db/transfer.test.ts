import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyImport, type ExportPayload } from './transfer'
import { createDefaultHealthProfile, db, SK } from './schema'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockDbWrites() {
  vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
    const scope = args[args.length - 1] as () => Promise<unknown>
    return scope()
  }) as typeof db.transaction)
  const dailyLogsBulkPut = vi.spyOn(db.dailyLogs, 'bulkPut').mockResolvedValue(undefined as never)
  const settingsBulkPut = vi.spyOn(db.settings, 'bulkPut').mockResolvedValue(undefined as never)
  const bookmarksBulkPut = vi.spyOn(db.contentBookmarks, 'bulkPut').mockResolvedValue(undefined as never)
  vi.spyOn(db.healthProfiles, 'get').mockResolvedValue(undefined)
  const healthProfilePut = vi.spyOn(db.healthProfiles, 'put').mockResolvedValue('primary' as never)
  return { dailyLogsBulkPut, settingsBulkPut, bookmarksBulkPut, healthProfilePut }
}

function basePayload(overrides: Partial<ExportPayload> = {}): ExportPayload {
  return {
    app: 'lunara',
    v: 1,
    exportedAt: '2026-07-26T00:00:00.000Z',
    dailyLogs: [],
    settings: [],
    contentBookmarks: [],
    ...overrides,
  }
}

describe('applyImport', () => {
  it('rejects a payload that is not a recognized Lunara export', async () => {
    mockDbWrites()
    await expect(applyImport({ ...basePayload(), app: 'other' as 'lunara' })).rejects.toThrow(
      'Not a Lunara export file',
    )
  })

  it('drops malformed daily logs and keeps well-formed ones', async () => {
    const { dailyLogsBulkPut } = mockDbWrites()
    const payload = basePayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dailyLogs: [
        { date: '2026-07-26', flow: 'medium' },
        { date: 'not-a-date', flow: 'medium' },
        { date: '2026-07-27', flow: 'invented-flow-level' },
        { date: '2026-07-28', bbt: 'hot' },
        { notFlow: true },
        null,
      ] as unknown as ExportPayload['dailyLogs'],
    })

    const count = await applyImport(payload)

    expect(count).toBe(1)
    expect(dailyLogsBulkPut).toHaveBeenCalledWith([{ date: '2026-07-26', flow: 'medium' }])
  })

  it('drops malformed settings and still strips secret keys', async () => {
    const { settingsBulkPut } = mockDbWrites()
    const payload = basePayload({
      settings: [
        { key: 'goal', value: 'ttc' },
        { key: SK.pinHash, value: 'should-never-import' },
        { value: 'missing-key' } as unknown as ExportPayload['settings'][number],
      ],
    })

    await applyImport(payload)

    expect(settingsBulkPut).toHaveBeenCalledWith([{ key: 'goal', value: 'ttc' }])
  })

  it('drops malformed content bookmarks', async () => {
    const { bookmarksBulkPut } = mockDbWrites()
    const payload = basePayload({
      contentBookmarks: [
        { slug: 'cycle-basics', savedAt: '2026-07-26T00:00:00.000Z' },
        { slug: '' } as unknown as ExportPayload['contentBookmarks'][number],
      ],
    })

    await applyImport(payload)

    expect(bookmarksBulkPut).toHaveBeenCalledWith([
      { slug: 'cycle-basics', savedAt: '2026-07-26T00:00:00.000Z' },
    ])
  })

  it('applies an included health profile, and skips it when absent', async () => {
    const withProfile = mockDbWrites()
    const profile = createDefaultHealthProfile('2026-07-26T00:00:00.000Z')
    await applyImport(basePayload({ healthProfile: { ...profile, primaryGoal: 'pregnancy' } }))
    expect(withProfile.healthProfilePut).toHaveBeenCalledOnce()
    expect(withProfile.healthProfilePut.mock.calls[0][0].primaryGoal).toBe('pregnancy')

    const withoutProfile = mockDbWrites()
    await applyImport(basePayload())
    expect(withoutProfile.healthProfilePut).not.toHaveBeenCalled()
  })
})
