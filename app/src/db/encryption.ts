import Dexie from 'dexie'
import type { DBCore, DBCoreTable, Middleware } from 'dexie'
import { isNative } from '../native/runtime'
import { getSecureSecret, SECURE_SECRET_KEYS, setSecureSecret } from '../native/secureVault'

/**
 * AES-256-GCM encryption for every record written to IndexedDB, so a raw
 * database dump (WebView cache, a device backup, casual DevTools inspection)
 * yields ciphertext, not plaintext health data. Registered as a Dexie DBCore
 * middleware in schema.ts — it is transparent to every existing Table.get /
 * .put / .bulkPut / .delete / .toArray() call in the app.
 *
 * Deliberately does NOT support Collection cursor queries (.filter(),
 * .where(), .each()) on encrypted tables — see openCursor below. The app's
 * only two call sites that used .filter() were rewritten to plain
 * .toArray() + an in-memory Array.filter() specifically so this boundary
 * never needs to be crossed.
 */

const LOCAL_STORAGE_KEY = 'lunara-db-key-fallback'
const ENCRYPTED_TABLES: Record<string, string> = {
  dailyLogs: 'date',
  cycles: 'startDate',
  settings: 'key',
  contentBookmarks: 'slug',
  healthProfiles: 'id',
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

/**
 * Native builds keep the key in Keychain/Keystore via the secure vault
 * bridge — a real hardware security boundary. Browser/dev mode has no OS
 * keystore; secureVault's web fallback there is in-memory only, which would
 * regenerate a new key (and silently orphan all existing encrypted data) on
 * every page reload. Losing all local health data on a refresh is worse than
 * the honest boundary of a same-origin-readable key, so browser mode persists
 * to localStorage instead: real protection against a raw IndexedDB dump or
 * casual DevTools inspection, but — unlike native — not protection against
 * someone with full access to this browser profile's storage.
 */
const hasLocalStorage = typeof localStorage !== 'undefined'

async function loadOrCreateKeyMaterial(): Promise<Uint8Array> {
  const existing = await getSecureSecret(SECURE_SECRET_KEYS.dbEncryptionKey)
  if (existing) return fromB64(existing)

  if (!isNative && hasLocalStorage) {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (stored) return fromB64(stored)
  }

  const fresh = crypto.getRandomValues(new Uint8Array(32))
  const encoded = toB64(fresh)
  await setSecureSecret(SECURE_SECRET_KEYS.dbEncryptionKey, encoded)
  if (!isNative && hasLocalStorage) localStorage.setItem(LOCAL_STORAGE_KEY, encoded)
  return fresh
}

let keyPromise: Promise<CryptoKey> | undefined

function getDbKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = loadOrCreateKeyMaterial().then((material) =>
      crypto.subtle.importKey('raw', material as BufferSource, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
      ]),
    )
  }
  return keyPromise
}

interface Envelope {
  __lunaraEnc: 1
  iv: string
  data: string
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && (value as Envelope).__lunaraEnc === 1
}

async function encryptRecord(pkField: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = await getDbKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const { [pkField]: pkValue, ...rest } = record
  const plaintext = new TextEncoder().encode(JSON.stringify(rest))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext)
  const envelope: Envelope = { __lunaraEnc: 1, iv: toB64(iv), data: toB64(data) }
  return { [pkField]: pkValue, ...envelope }
}

async function decryptRecord(pkField: string, stored: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isEnvelope(stored)) return stored // pre-encryption row from an older install; read as-is
  const key = await getDbKey()
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(stored.iv) as BufferSource },
    key,
    fromB64(stored.data) as BufferSource,
  )
  const rest = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>
  return { [pkField]: stored[pkField], ...rest }
}

function unsupportedCursor(tableName: string): never {
  throw new Error(
    `Encrypted table "${tableName}" does not support cursor-based queries ` +
      '(.filter()/.where()/.each()/.orderBy()). Use .toArray() and filter the ' +
      'result in memory instead — see db/encryption.ts.',
  )
}

export const encryptionMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'lunara-encryption',
  create(downlevelDatabase) {
    return {
      ...downlevelDatabase,
      table(tableName: string): DBCoreTable {
        const downlevelTable = downlevelDatabase.table(tableName)
        const pkField = ENCRYPTED_TABLES[tableName]
        if (!pkField) return downlevelTable

        // crypto.subtle is genuinely async and not IndexedDB-transaction-aware,
        // so an unguarded await here lets Dexie's IDB transaction auto-commit
        // (idle) before the real request is issued — every operation below
        // fails in production the same way it fails against fake-indexeddb in
        // tests. Dexie.waitFor() is the documented fix: it keeps the
        // surrounding transaction alive while a non-IDB promise is pending.
        return {
          ...downlevelTable,
          mutate: async (req) => {
            if (req.type === 'add' || req.type === 'put') {
              const values = await Dexie.waitFor(
                Promise.all(req.values.map((value: Record<string, unknown>) => encryptRecord(pkField, value))),
              )
              return downlevelTable.mutate({ ...req, values })
            }
            return downlevelTable.mutate(req)
          },
          get: async (req) => {
            const result = await downlevelTable.get(req)
            return result
              ? Dexie.waitFor(decryptRecord(pkField, result as Record<string, unknown>))
              : result
          },
          getMany: async (req) => {
            const results = await downlevelTable.getMany(req)
            return Dexie.waitFor(
              Promise.all(
                results.map((row: unknown) =>
                  row ? decryptRecord(pkField, row as Record<string, unknown>) : row,
                ),
              ),
            )
          },
          query: async (req) => {
            const res = await downlevelTable.query(req)
            if (!req.values) return res // keys-only query — nothing to decrypt
            return {
              ...res,
              result: await Dexie.waitFor(
                Promise.all(
                  res.result.map((row: unknown) => decryptRecord(pkField, row as Record<string, unknown>)),
                ),
              ),
            }
          },
          openCursor: () => unsupportedCursor(tableName),
        }
      },
    }
  },
}
