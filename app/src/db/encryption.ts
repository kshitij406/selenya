import type { DBCore, DBCoreTable, Middleware, Table } from 'dexie'
import { isNative } from '../native/runtime'
import { getSecureSecret, SECURE_SECRET_KEYS, setSecureSecret } from '../native/secureVault'

/**
 * AES-256-GCM encryption for every record written to IndexedDB, so a raw
 * database dump (WebView cache, a device backup, casual DevTools inspection)
 * yields ciphertext, not plaintext health data.
 *
 * Encryption happens at the Table API level (wrapTableEncryption, called
 * from schema.ts after each table is set up), not inside a Dexie DBCore
 * middleware. An earlier version did crypto.subtle work inside the
 * DBCore mutate/get/query hooks wrapped in Dexie.waitFor() — that is
 * Dexie's officially documented pattern for foreign async work during a
 * transaction, but it does not reliably keep the transaction alive across
 * a real crypto.subtle call on Android WebView: the first-ever write threw
 * "InvalidStateError: Failed to execute 'objectStore' on 'IDBTransaction':
 * The transaction has finished" on physical-device testing, even though
 * the identical code passed against fake-indexeddb in tests. The fix is to
 * never do async crypto while a Dexie transaction is open at all: encrypt
 * BEFORE calling the real .put()/.bulkPut() (so Dexie only ever opens a
 * transaction around an already-resolved plain value), and decrypt AFTER
 * the real .get()/.toArray() has already resolved and closed its
 * transaction. ensureHealthProfile() was also changed to stop wrapping its
 * reads/writes in an explicit db.transaction(...) block for the same
 * reason — see wrapTableEncryption below and schema.ts.
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

/**
 * Start loading/deriving the encryption key immediately, before any Dexie
 * transaction needs it. The first real write otherwise has to wait for BOTH
 * a native-bridge round-trip (secureVault) AND WebCrypto inside a single
 * Dexie.waitFor() window — on real Android WebView that combined latency is
 * enough to blow past what Dexie.waitFor can keep the IndexedDB transaction
 * alive for, throwing InvalidStateError on the very first app launch. Call
 * this (and ideally await it) before the app's first Dexie operation.
 */
export function warmDbKey(): Promise<void> {
  return getDbKey().then(() => undefined)
}
void warmDbKey()

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

/**
 * Cheap, synchronous, defense-in-depth guard only: makes a stray .filter()/
 * .where()/.each() on an encrypted table fail loudly with a clear message
 * instead of silently handing back undecrypted ciphertext envelopes. Does
 * no crypto itself, so it carries none of the transaction-liveness risk
 * that made a DBCore-level encrypt/decrypt hook unsafe (see file header).
 */
export const cursorGuardMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'lunara-encrypted-cursor-guard',
  create(downlevelDatabase) {
    return {
      ...downlevelDatabase,
      table(tableName: string): DBCoreTable {
        const downlevelTable = downlevelDatabase.table(tableName)
        if (!ENCRYPTED_TABLES[tableName]) return downlevelTable
        return { ...downlevelTable, openCursor: () => unsupportedCursor(tableName) }
      },
    }
  },
}

/**
 * Patches a Table's get/put/delete/bulkPut/toArray so every value is
 * encrypted before Dexie opens a transaction to write it, and decrypted
 * only after Dexie's transaction for a read has already resolved and
 * closed. This is the app's only Dexie method surface (confirmed: no
 * .where()/.each()/.orderBy()/.bulkGet()/.bulkDelete()/.update() usage
 * anywhere in the codebase) — cursorGuardMiddleware above turns any future
 * use of an unwrapped method into a loud error instead of a silent bug.
 */
export function wrapTableEncryption<T, K extends string>(table: Table<T, K>, pkField: string): void {
  const originalGet = table.get.bind(table)
  const originalPut = table.put.bind(table)
  const originalBulkPut = table.bulkPut.bind(table)
  const originalToArray = table.toArray.bind(table)

  table.get = (async (key: K) => {
    const raw = await originalGet(key)
    return raw ? (decryptRecord(pkField, raw as Record<string, unknown>) as unknown as T) : raw
  }) as Table<T, K>['get']

  table.toArray = (async () => {
    const raw = await originalToArray()
    return Promise.all(raw.map((row) => decryptRecord(pkField, row as Record<string, unknown>))) as Promise<T[]>
  }) as Table<T, K>['toArray']

  table.put = (async (item: T, key?: K) => {
    const encrypted = await encryptRecord(pkField, item as Record<string, unknown>)
    return originalPut(encrypted as unknown as T, key)
  }) as Table<T, K>['put']

  table.bulkPut = (async (items: readonly T[]) => {
    const encrypted = await Promise.all(
      items.map((item) => encryptRecord(pkField, item as Record<string, unknown>)),
    )
    return originalBulkPut(encrypted as unknown as T[])
  }) as Table<T, K>['bulkPut']
}
