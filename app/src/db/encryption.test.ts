// Registers global indexedDB/IDBKeyRange before anything else imports Dexie.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, ensureHealthProfile, getPeriodStarts, getSetting, putHealthProfile, setSetting, SK } from './schema'

/**
 * The rest of the test suite mocks db.* methods directly, so it would still
 * pass even if the encryption middleware silently broke every read/write.
 * This file is the one test that talks to a real (fake) IndexedDB backend,
 * to prove two things end-to-end: normal app code still gets correct
 * decrypted data back, AND the actual bytes on disk are ciphertext, not the
 * plaintext health data.
 */

async function rawStoredRow(table: string, key: string): Promise<unknown> {
  // Bypasses Dexie (and therefore the encryption middleware) entirely, via
  // Dexie's own escape hatch to the underlying native IDBDatabase, to see
  // exactly what got written to disk.
  const backend = db.backendDB()
  return new Promise((resolve, reject) => {
    const tx = backend.transaction(table, 'readonly')
    const req = tx.objectStore(table).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

beforeEach(async () => {
  await db.dailyLogs.clear()
  await db.settings.clear()
})

describe('encrypted local storage', () => {
  it('round-trips a daily log through get/put with the real value intact', async () => {
    await db.dailyLogs.put({ date: '2026-02-01', flow: 'heavy', notes: 'a private note' })
    const back = await db.dailyLogs.get('2026-02-01')
    expect(back).toMatchObject({ date: '2026-02-01', flow: 'heavy', notes: 'a private note' })
  })

  it('never writes plaintext health fields to the underlying IndexedDB row', async () => {
    await db.dailyLogs.put({ date: '2026-02-02', flow: 'medium', notes: 'a private note' })
    const raw = (await rawStoredRow('dailyLogs', '2026-02-02')) as Record<string, unknown>

    expect(raw.date).toBe('2026-02-02') // primary key stays plaintext by design
    expect(raw.flow).toBeUndefined()
    expect(raw.notes).toBeUndefined()
    expect(raw.__lunaraEnc).toBe(1)
    expect(typeof raw.iv).toBe('string')
    expect(typeof raw.data).toBe('string')
    expect(String(raw.data)).not.toContain('a private note')
  })

  it('round-trips settings (e.g. the PIN hash) without storing them in the clear', async () => {
    await setSetting(SK.pinHash, 'super-secret-hash-value')
    expect(await getSetting(SK.pinHash)).toBe('super-secret-hash-value')

    const raw = (await rawStoredRow('settings', SK.pinHash)) as Record<string, unknown>
    expect(raw.value).toBeUndefined()
    expect(raw.__lunaraEnc).toBe(1)
  })

  it('computes period starts correctly through the toArray()-based rewrite of the old .filter() call', async () => {
    await db.dailyLogs.bulkPut([
      { date: '2026-03-01', flow: 'medium' },
      { date: '2026-03-02', flow: 'light' },
      { date: '2026-03-15', flow: 'heavy' },
    ])
    expect(await getPeriodStarts()).toEqual(['2026-03-01', '2026-03-15'])
  })

  it('refuses a cursor-based query instead of silently returning encrypted garbage', async () => {
    await db.dailyLogs.put({ date: '2026-04-01', flow: 'light' })
    await expect(db.dailyLogs.filter((l) => l.flow === 'light').toArray()).rejects.toThrow(
      /does not support cursor/,
    )
  })

  it('survives a multi-step explicit transaction (get then put in the same tx)', async () => {
    await db.healthProfiles.clear()
    // ensureHealthProfile/putHealthProfile wrap a get + put in one
    // db.transaction('rw', ...) block — a second, independent way the
    // encrypt/decrypt await could let the transaction go idle between calls.
    const created = await ensureHealthProfile()
    expect(created.id).toBe('primary')

    const updated = await putHealthProfile({ displayName: 'Riley' })
    expect(updated.displayName).toBe('Riley')

    const reloaded = await db.healthProfiles.get('primary')
    expect(reloaded?.displayName).toBe('Riley')
  })
})
