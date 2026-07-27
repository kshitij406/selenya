import { decryptJSON, encryptJSON, type Envelope } from '../crypto/vault'
import {
  db,
  getHealthProfile,
  putHealthProfile,
  SK,
  type ContentBookmark,
  type DailyLog,
  type HealthProfile,
  type Setting,
} from './schema'

/** Settings that must never leave the device. */
const SECRET_KEYS: string[] = [SK.pinSalt, SK.pinHash, SK.aiKey]

const FLOW_VALUES = new Set(['light', 'medium', 'heavy', 'clots'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Minimal shape/type guard for an imported daily log. Import data comes from
 * a decrypted backup or a user-picked file, so it must not be trusted blindly
 * before it reaches cycle prediction, exports, or charts.
 */
function isValidDailyLog(entry: unknown): entry is DailyLog {
  if (typeof entry !== 'object' || entry === null) return false
  const log = entry as Record<string, unknown>
  if (typeof log.date !== 'string' || !DATE_RE.test(log.date)) return false
  if (log.flow !== undefined && !FLOW_VALUES.has(log.flow as string)) return false
  if (log.checkInComplete !== undefined && typeof log.checkInComplete !== 'boolean') return false
  if (log.periodStart !== undefined && typeof log.periodStart !== 'boolean') return false
  if (log.symptoms !== undefined && !isStringArray(log.symptoms)) return false
  if (log.moods !== undefined && !isStringArray(log.moods)) return false
  if (log.events !== undefined && !isStringArray(log.events)) return false
  if (log.bbt !== undefined && !Number.isFinite(log.bbt)) return false
  if (log.weightKg !== undefined && !Number.isFinite(log.weightKg)) return false
  if (log.waterMl !== undefined && !Number.isFinite(log.waterMl)) return false
  if (log.sleepMinutes !== undefined && !Number.isFinite(log.sleepMinutes)) return false
  if (log.steps !== undefined && !Number.isFinite(log.steps)) return false
  if (log.notes !== undefined && typeof log.notes !== 'string') return false
  return true
}

function isValidSetting(entry: unknown): entry is Setting {
  if (typeof entry !== 'object' || entry === null) return false
  const setting = entry as Record<string, unknown>
  return typeof setting.key === 'string' && setting.key.length > 0 && typeof setting.value === 'string'
}

function isValidContentBookmark(entry: unknown): entry is ContentBookmark {
  if (typeof entry !== 'object' || entry === null) return false
  const bookmark = entry as Record<string, unknown>
  return typeof bookmark.slug === 'string' && bookmark.slug.length > 0 && typeof bookmark.savedAt === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Keep only well-formed rows, warning about anything dropped from an import. */
function sanitizeImportArray<T>(rows: unknown[], isValid: (entry: unknown) => entry is T, label: string): T[] {
  const valid: T[] = []
  let skipped = 0
  for (const row of rows) {
    if (isValid(row)) valid.push(row)
    else skipped++
  }
  if (skipped > 0) console.warn(`Import: skipped ${skipped} malformed ${label} row(s)`)
  return valid
}

export interface ExportPayload {
  app: 'lunara'
  v: 1
  exportedAt: string
  dailyLogs: DailyLog[]
  settings: Setting[]
  contentBookmarks: ContentBookmark[]
  /** Added later — optional so older export files and existing tests still round-trip. */
  healthProfile?: HealthProfile
}

export async function collectExport(): Promise<ExportPayload> {
  const [dailyLogs, settings, contentBookmarks, healthProfile] = await Promise.all([
    db.dailyLogs.toArray(),
    db.settings.toArray(),
    db.contentBookmarks.toArray(),
    getHealthProfile(),
  ])
  return {
    app: 'lunara',
    v: 1,
    exportedAt: new Date().toISOString(),
    dailyLogs,
    settings: settings.filter((s) => !SECRET_KEYS.includes(s.key)),
    contentBookmarks,
    healthProfile,
  }
}

export async function applyImport(payload: ExportPayload): Promise<number> {
  if (payload.app !== 'lunara' || payload.v !== 1) throw new Error('Not a Lunara export file')
  const dailyLogs = sanitizeImportArray(payload.dailyLogs ?? [], isValidDailyLog, 'dailyLogs')
  const settings = sanitizeImportArray(payload.settings ?? [], isValidSetting, 'settings').filter(
    (s) => !SECRET_KEYS.includes(s.key),
  )
  const contentBookmarks = sanitizeImportArray(
    payload.contentBookmarks ?? [],
    isValidContentBookmark,
    'contentBookmarks',
  )
  await db.transaction('rw', db.dailyLogs, db.settings, db.contentBookmarks, async () => {
    await db.dailyLogs.bulkPut(dailyLogs)
    await db.settings.bulkPut(settings)
    await db.contentBookmarks.bulkPut(contentBookmarks)
  })
  // putHealthProfile normalizes any shape (including garbage) to a complete,
  // safe HealthProfile — no separate type guard needed, same as every other
  // caller that feeds it untrusted/partial input.
  if (payload.healthProfile) await putHealthProfile(payload.healthProfile)
  return dailyLogs.length
}

export async function encryptedExport(passphrase: string): Promise<Envelope> {
  return encryptJSON(await collectExport(), passphrase)
}

export async function decryptImport(env: Envelope, passphrase: string): Promise<number> {
  return applyImport(await decryptJSON<ExportPayload>(env, passphrase))
}

/** Share-sheet first (iOS → Save to Files → iCloud Drive), download fallback. */
export async function shareOrDownload(filename: string, contents: string): Promise<void> {
  const blob = new Blob([contents], { type: 'application/json' })
  const file = new File([blob], filename, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch {
      // fall through to download (user cancel or share failure)
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
