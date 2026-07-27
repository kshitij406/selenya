import Dexie, { type Table } from 'dexie'
import { cursorGuardMiddleware, wrapTableEncryption } from './encryption'
import { detectBbtShiftEstimates } from '../engine/cycle'
import type { PregnancyDatingMethod } from '../engine/pregnancyDating'

export type Flow = 'light' | 'medium' | 'heavy' | 'clots'
export type Discharge =
  | 'none'
  | 'sticky'
  | 'creamy'
  | 'egg-white'
  | 'spotting'
  | 'watery'
  | 'unusual'
  | 'clumpy-white'
  | 'gray'
export type Goal = 'cycle' | 'ttc' | 'pregnancy' | 'peri'
export type SymptomSeverity = 'mild' | 'moderate' | 'severe'
export type SymptomImpairment = 'none' | 'noticeable' | 'limited-routine'

export interface SymptomRating {
  severity?: SymptomSeverity
  impairment?: SymptomImpairment
}

export type LegacySexEvent = 'protected' | 'unprotected' | 'high-drive' | 'low-drive'
export type IntimacyEvent =
  | 'no-sex'
  | 'protected'
  | 'unprotected'
  | 'oral'
  | 'anal'
  | 'masturbation'
  | 'sensual-touch'
  | 'sex-toys'
  | 'orgasm'
  | 'neutral-drive'
  | 'high-drive'
  | 'low-drive'
export type PregnancyTestResult = 'not-taken' | 'positive' | 'negative' | 'faint'
export type DigestionEvent =
  | 'nausea'
  | 'bloating'
  | 'constipation'
  | 'diarrhea'
  | 'gas'
  | 'indigestion'
  | 'appetite-low'
  | 'appetite-high'
export type ActivityEvent =
  | 'no-exercise'
  | 'walking'
  | 'running'
  | 'strength'
  | 'yoga'
  | 'cycling'
  | 'swimming'
  | 'aerobics-dance'
  | 'team-sports'
  | 'stretching'
export type LifestyleEvent =
  | 'travel'
  | 'stress'
  | 'meditation'
  | 'journaling'
  | 'kegel-exercises'
  | 'breathing-exercises'
  | 'illness-injury'
  | 'alcohol'
  | 'caffeine'
  | 'social-time'
  | 'time-outdoors'

export type CycleRegularity = 'regular' | 'irregular' | 'unsure'
export type AnswerChoice = 'yes' | 'no' | 'unsure' | 'prefer-not-to-say'
export type ContraceptionMethod =
  | 'none'
  | 'combined-pill-patch-ring'
  | 'progestin-only-pill'
  | 'injection'
  | 'implant'
  | 'hormonal-iud'
  | 'copper-iud'
  | 'barrier'
  | 'sterilization'
  | 'other'
  | 'unknown'
  | 'prefer-not-to-say'
export type KnownHealthCondition =
  | 'pcos'
  | 'endometriosis'
  | 'fibroids'
  | 'adenomyosis'
  | 'thyroid-condition'
  | 'perimenopause'
  | 'postpartum'
  | 'yeast-infections'
  | 'uti'
  | 'bacterial-vaginosis'
  | 'other'
/** Known identifiers retain autocomplete while allowing future local taxonomy entries. */
export type HealthCondition = KnownHealthCondition | (string & {})
export type ActivityLevel =
  | 'mostly-sedentary'
  | 'some-active-breaks'
  | 'on-feet-most-of-day'
  | 'very-active'
  | 'unknown'
export type WearableBrand = 'none' | 'apple' | 'fitbit' | 'garmin' | 'other' | 'unknown'
export type PermissionState = 'not-requested' | 'requested' | 'granted' | 'denied'

export type HealthImportProvider = 'apple-health' | 'health-connect'
export type HealthImportField =
  | 'flow'
  | 'bbt'
  | 'opk'
  | 'weightKg'
  | 'sleepMinutes'
  | 'steps'

/**
 * Field-level provenance for values copied from a device health store.
 *
 * The sample identifiers make a repeated import idempotent. Keeping this
 * metadata per field also lets a later hand-entered value take ownership of
 * only that value without erasing provenance for the rest of the day.
 */
export interface HealthImportProvenance {
  provider: HealthImportProvider
  sampleIds: string[]
  sourceNames?: string[]
  /** HealthKit's HKMetadataKeyMenstrualCycleStart, when present on flow samples. */
  menstrualCycleStart?: boolean
  importedAt: string
}

export interface HealthProfileCycle {
  regularity: CycleRegularity
  lastPeriodStart?: string
  typicalCycleLength?: number
  typicalPeriodLength?: number
  dateConfidence: 'known' | 'approximate' | 'unknown'
  abnormalities: string[]
  baselineSymptoms: string[]
  hormonalSignals: string[]
}

export interface HealthProfileReproductive {
  contraception: ContraceptionMethod
  pregnancyLmp?: string
  pregnancyDating?: {
    method: PregnancyDatingMethod
    inputDate: string
    estimatedDueDate: string
    gestationalStart: string
    authority: 'clinician-assigned' | 'art-derived' | 'user-estimated'
    provisional: boolean
    updatedAt: string
  }
  numberOfBabies?: number
  tryingSince?: string
}

export interface HealthProfileWellbeing {
  sleepImpact?: AnswerChoice
  sleepGoals: string[]
  skinImpact?: AnswerChoice
  activityImpact?: AnswerChoice
  activityLevel: ActivityLevel
  wearable: WearableBrand
  mentalHealthSignals: string[]
  sexualWellnessGoals: string[]
}

export interface HealthProfileBiometrics {
  heightCm?: number
  weightKg?: number
}

export interface HealthProfilePermissions {
  motionFitness: PermissionState
  healthData: PermissionState
  notifications: PermissionState
}

export type ConsentPurpose =
  | 'local-health-storage'
  | 'assistant-sharing'
  | 'health-import'
  | 'notifications'

export interface ConsentDecision {
  purpose: ConsentPurpose
  state: 'granted' | 'declined' | 'not-requested'
  version: 1
  decidedAt: string
}

export interface HealthProfilePrivacy {
  ageBand: 'unknown' | '13-15' | '16-17' | 'adult'
  minimumAgeConfirmed: boolean
  localOnly: boolean
  onboardingVersion: 2
  consentLedger: ConsentDecision[]
}

/**
 * Versioned, local-first inputs that tailor predictions and education.
 *
 * This record is intentionally separate from DailyLog: onboarding answers
 * describe a durable baseline, while DailyLog remains the time-series source.
 * Conditions and symptoms personalize caution/uncertainty only; they are not
 * diagnoses and must never be treated as confirmed clinical findings.
 */
export interface HealthProfile {
  id: 'primary'
  schemaVersion: 2
  createdAt: string
  updatedAt: string
  displayName?: string
  birthYear?: number
  goals: Goal[]
  primaryGoal: Goal
  cycle: HealthProfileCycle
  reproductive: HealthProfileReproductive
  conditions: HealthCondition[]
  wellbeing: HealthProfileWellbeing
  biometrics: HealthProfileBiometrics
  permissions: HealthProfilePermissions
  privacy: HealthProfilePrivacy
}

export type HealthProfilePatch = Partial<
  Omit<
    HealthProfile,
    'id' | 'schemaVersion' | 'cycle' | 'reproductive' | 'wellbeing' | 'biometrics' | 'permissions' | 'privacy'
  >
> & {
  cycle?: Partial<HealthProfileCycle>
  reproductive?: Partial<HealthProfileReproductive>
  wellbeing?: Partial<HealthProfileWellbeing>
  biometrics?: Partial<HealthProfileBiometrics>
  permissions?: Partial<HealthProfilePermissions>
  privacy?: Partial<HealthProfilePrivacy>
}

/**
 * Structured answers to the small set of questions `engine/safety.ts`
 * actually rules on. Deliberately narrow — this is not a general symptom
 * log, it exists only to feed `evaluateSafetyTriage`.
 */
export interface SafetyCheckIn {
  /** Soaking a pad/tampon at least once an hour, for at least two hours straight. */
  heavySoakingTwoHoursPlus?: boolean
  dizziness?: boolean
  lightheadedness?: boolean
  chestPain?: boolean
  shortnessOfBreath?: boolean
  bleedingBetweenPeriods?: boolean
  bleedingAfterMenopause?: boolean
  suddenSeverePelvicPain?: boolean
  persistentOrRecurringPelvicPain?: boolean
  pregnancyVaginalBleeding?: boolean
  pregnancyPelvicPain?: boolean
  pregnancyFainting?: boolean
  pregnancyShoulderPain?: boolean
  thoughtsOfSelfHarm?: boolean
}

export interface DailyLog {
  /** 'YYYY-MM-DD' — primary key; one log per day. */
  date: string
  /** Explicit coverage marker; a missing marker never means “nothing happened.” */
  checkInComplete?: boolean
  flow?: Flow
  /** Explicit start marker supplied by an imported health record. */
  periodStart?: boolean
  symptoms?: string[]
  /** Optional per-symptom detail; selections remain valid without a rating. */
  symptomRatings?: Record<string, SymptomRating>
  moods?: string[]
  /** Extensible non-diagnostic event taxonomy (sleep, activity, medication, etc.). */
  events?: string[]
  discharge?: Discharge
  /**
   * Legacy single-select intimacy value retained for old exports and engines.
   * New logging writes the richer `intimacyEvents` collection as canonical.
   */
  sex?: LegacySexEvent
  intimacyEvents?: IntimacyEvent[]
  pregnancyTest?: PregnancyTestResult
  digestion?: DigestionEvent[]
  activities?: ActivityEvent[]
  lifestyle?: LifestyleEvent[]
  /** Basal body temperature, °C ×100 (integer, avoids float drift). */
  bbt?: number
  opk?: 'positive' | 'negative'
  weightKg?: number
  waterMl?: number
  sleepMinutes?: number
  steps?: number
  notes?: string
  /**
   * Import provenance is not itself a health event. It accompanies copied
   * fields and is removed when the user edits that field by hand.
   */
  healthImports?: Partial<Record<HealthImportField, HealthImportProvenance>>
  safetyCheckIn?: SafetyCheckIn
}

/**
 * Read old single-value intimacy logs without rewriting history. Once a user
 * edits that check-in, the richer collection is stored alongside the legacy
 * compatibility field.
 */
export function normalizeDailyLog(log: DailyLog): DailyLog {
  const intimacyEvents =
    log.intimacyEvents === undefined
      ? log.sex
        ? [log.sex]
        : undefined
      : [...new Set(log.intimacyEvents)]
  return { ...log, intimacyEvents }
}

/** Give one or more imported fields back to the user after a manual edit. */
export function clearHealthImportProvenance(
  log: DailyLog,
  fields: HealthImportField | HealthImportField[],
): DailyLog {
  const fieldList = Array.isArray(fields) ? fields : [fields]
  const next = { ...log }
  if (fieldList.includes('flow')) delete next.periodStart
  if (!log.healthImports) return next
  const nextImports = { ...log.healthImports }
  for (const field of fieldList) {
    delete nextImports[field]
  }
  if (Object.keys(nextImports).length) next.healthImports = nextImports
  else delete next.healthImports
  return next
}

/** A complete symptom-free check-in is data; an untouched draft is not. */
export function dailyLogHasEntry(log: DailyLog): boolean {
  return Boolean(
    log.checkInComplete ||
      log.flow ||
      log.symptoms?.length ||
      Object.keys(log.symptomRatings ?? {}).length ||
      log.moods?.length ||
      log.events?.length ||
      log.discharge ||
      log.sex ||
      log.intimacyEvents?.length ||
      log.pregnancyTest ||
      log.digestion?.length ||
      log.activities?.length ||
      log.lifestyle?.length ||
      log.bbt !== undefined ||
      log.opk ||
      log.weightKg !== undefined ||
      log.waterMl !== undefined ||
      log.sleepMinutes !== undefined ||
      log.steps !== undefined ||
      log.notes?.trim() ||
      Object.values(log.safetyCheckIn ?? {}).some(Boolean),
  )
}

export interface Setting {
  key: string
  value: string
}

export interface ContentBookmark {
  slug: string
  savedAt: string
}

/**
 * A dated contraception or ongoing-medication regimen — the first-class
 * history `HealthProfileReproductive.contraception` (a single current
 * value, no dates) doesn't provide. `endDate` unset means still active.
 */
export interface ContraceptionRegimenEntry {
  id: string
  method: ContraceptionMethod
  productName?: string
  startDate: string
  endDate?: string
  /** Days between pack/patch/ring changes or injections, when regular (e.g. 28, 90). */
  renewalIntervalDays?: number
  /** Next change/refill/replacement date — manually set or derived from renewalIntervalDays. */
  nextRenewalDate?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export class LunaraDB extends Dexie {
  dailyLogs!: Table<DailyLog, string>
  settings!: Table<Setting, string>
  contentBookmarks!: Table<ContentBookmark, string>
  contraceptionRegimens!: Table<ContraceptionRegimenEntry, string>
  healthProfiles!: Table<HealthProfile, string>

  constructor() {
    super('lunara')
    this.use(cursorGuardMiddleware)
    this.version(1).stores({
      dailyLogs: 'date',
      cycles: 'startDate',
      settings: 'key',
      contentBookmarks: 'slug',
    })
    this.version(2)
      .stores({
        dailyLogs: 'date',
        cycles: 'startDate',
        settings: 'key',
        contentBookmarks: 'slug',
        healthProfiles: 'id',
      })
      .upgrade(async (transaction) => {
        const settings = await transaction.table<Setting, string>('settings').toArray()
        await transaction
          .table<HealthProfile, string>('healthProfiles')
          .put(healthProfileFromLegacySettings(new Map(settings.map((item) => [item.key, item.value]))))
      })
    this.version(3).stores({
      dailyLogs: 'date',
      cycles: 'startDate',
      settings: 'key',
      contentBookmarks: 'slug',
      healthProfiles: 'id',
      contraceptionRegimens: 'id',
    })
    wrapTableEncryption(this.dailyLogs, 'date')
    wrapTableEncryption(this.settings, 'key')
    wrapTableEncryption(this.contentBookmarks, 'slug')
    wrapTableEncryption(this.healthProfiles, 'id')
    wrapTableEncryption(this.contraceptionRegimens, 'id')
  }
}

export const db = new LunaraDB()

/**
 * Period starts for the engine: first day of each run of consecutive
 * flow-logged days.
 */
export async function getPeriodStarts(): Promise<string[]> {
  // Plain toArray() + in-memory filter, not Dexie's .filter() Collection API:
  // the latter is cursor-driven and encrypted tables don't support cursors
  // (see db/encryption.ts) — everything here already needs full decryption
  // per row anyway, so a full-table scan costs nothing extra.
  const flowLogs = (await db.dailyLogs.toArray()).filter((l) => l.flow !== undefined)
  flowLogs.sort((a, b) => a.date.localeCompare(b.date))
  const starts: string[] = []
  let prevEpoch = Number.NEGATIVE_INFINITY
  for (const log of flowLogs) {
    const d = log.date
    const [y, m, day] = d.split('-').map(Number)
    const epoch = Date.UTC(y, m - 1, day) / 86_400_000
    if (log.periodStart || epoch - prevEpoch > 1) starts.push(d)
    prevEpoch = epoch
  }
  return [...new Set(starts)]
}

export async function getOvulations(): Promise<string[]> {
  const logs = await db.dailyLogs.toArray()
  // A positive ovulation test suggests an LH surge; it does not confirm that
  // ovulation occurred. Keep OPK dates available to the TTC evidence view, but
  // only feed conservative sustained-temperature shifts into the cycle engine.
  return detectBbtShiftEstimates(
    logs
      .filter((l): l is DailyLog & { bbt: number } => l.bbt !== undefined)
      .map((l) => ({ date: l.date, bbt: l.bbt })),
  )
}

export async function getSetting(key: string): Promise<string | undefined> {
  return (await db.settings.get(key))?.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value })
}

export async function removeSetting(key: string): Promise<void> {
  await db.settings.delete(key)
}

function isGoal(value: string | undefined): value is Goal {
  return value === 'cycle' || value === 'ttc' || value === 'pregnancy' || value === 'peri'
}

function optionalFiniteNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function createDefaultHealthProfile(now = new Date().toISOString()): HealthProfile {
  return {
    id: 'primary',
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    goals: ['cycle'],
    primaryGoal: 'cycle',
    cycle: {
      regularity: 'unsure',
      dateConfidence: 'unknown',
      abnormalities: [],
      baselineSymptoms: [],
      hormonalSignals: [],
    },
    reproductive: {
      contraception: 'unknown',
    },
    conditions: [],
    wellbeing: {
      sleepGoals: [],
      activityLevel: 'unknown',
      wearable: 'unknown',
      mentalHealthSignals: [],
      sexualWellnessGoals: [],
    },
    biometrics: {},
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
  }
}

/**
 * Merge a partial profile with every current default. This lets older stored
 * profile versions remain readable when new optional onboarding fields ship.
 */
export function normalizeHealthProfile(
  profile: HealthProfilePatch & Partial<Pick<HealthProfile, 'id' | 'schemaVersion'>> = {},
  now = new Date().toISOString(),
): HealthProfile {
  const defaults = createDefaultHealthProfile(now)
  const goals = [...new Set(profile.goals ?? defaults.goals)]
  const primaryGoal = profile.primaryGoal ?? goals[0] ?? defaults.primaryGoal
  if (!goals.includes(primaryGoal)) goals.unshift(primaryGoal)

  return {
    ...defaults,
    ...profile,
    id: 'primary',
    schemaVersion: 2,
    createdAt: profile.createdAt ?? defaults.createdAt,
    updatedAt: profile.updatedAt ?? now,
    goals,
    primaryGoal,
    cycle: {
      ...defaults.cycle,
      ...profile.cycle,
      abnormalities: profile.cycle?.abnormalities ?? defaults.cycle.abnormalities,
      baselineSymptoms: profile.cycle?.baselineSymptoms ?? defaults.cycle.baselineSymptoms,
      hormonalSignals: profile.cycle?.hormonalSignals ?? defaults.cycle.hormonalSignals,
    },
    reproductive: {
      ...defaults.reproductive,
      ...profile.reproductive,
    },
    conditions: profile.conditions ?? defaults.conditions,
    wellbeing: {
      ...defaults.wellbeing,
      ...profile.wellbeing,
      sleepGoals: profile.wellbeing?.sleepGoals ?? defaults.wellbeing.sleepGoals,
      mentalHealthSignals:
        profile.wellbeing?.mentalHealthSignals ?? defaults.wellbeing.mentalHealthSignals,
      sexualWellnessGoals:
        profile.wellbeing?.sexualWellnessGoals ?? defaults.wellbeing.sexualWellnessGoals,
    },
    biometrics: {
      ...defaults.biometrics,
      ...profile.biometrics,
    },
    permissions: {
      ...defaults.permissions,
      ...profile.permissions,
    },
    privacy: {
      ...defaults.privacy,
      ...profile.privacy,
      consentLedger: profile.privacy?.consentLedger ?? defaults.privacy.consentLedger,
    },
  }
}

function healthProfileFromLegacySettings(
  legacy: ReadonlyMap<string, string>,
  now = new Date().toISOString(),
): HealthProfile {
  const rawGoal = legacy.get('goal')
  const legacyGoal: Goal = isGoal(rawGoal) ? rawGoal : 'cycle'
  const pregnancyLmp = legacy.get('pregnancyLMP')
  return normalizeHealthProfile(
    {
      birthYear: optionalFiniteNumber(legacy.get('birthYear')),
      goals: [legacyGoal],
      primaryGoal: legacyGoal,
      cycle: {
        lastPeriodStart: pregnancyLmp,
        typicalCycleLength: optionalFiniteNumber(legacy.get('cycleLength')),
        dateConfidence: pregnancyLmp ? 'known' : 'unknown',
      },
      reproductive: {
        pregnancyLmp,
      },
      createdAt: now,
      updatedAt: now,
    },
    now,
  )
}

/**
 * Return the primary profile without mutating the database.
 *
 * This function is intentionally read-only because it is used from Dexie
 * liveQuery callbacks. Dexie runs those callbacks in a read-only observation
 * context and rejects any write attempted while the callback is active.
 * Missing profiles are derived in memory from legacy settings; the separate
 * ensureHealthProfile() bootstrap persists that migration outside liveQuery.
 */
export async function getHealthProfile(): Promise<HealthProfile> {
  const stored = await db.healthProfiles.get('primary')
  if (stored) return normalizeHealthProfile(stored, stored.updatedAt)

  const settings = await db.settings.toArray()
  return healthProfileFromLegacySettings(new Map(settings.map((item) => [item.key, item.value])))
}

/**
 * Persist the primary profile once during app bootstrap. This must be invoked
 * outside a liveQuery callback.
 */
export async function ensureHealthProfile(): Promise<HealthProfile> {
  // Deliberately not wrapped in db.transaction(...): each call below gets
  // its own implicit transaction instead, so the encrypt/decrypt work in
  // wrapTableEncryption never has to happen while a Dexie transaction is
  // still open (see db/encryption.ts's file header for why that matters).
  // A rare double-write of the same default profile on a concurrent first
  // launch is harmless and self-correcting; it replaces a guaranteed crash.
  const stored = await db.healthProfiles.get('primary')
  if (stored) return normalizeHealthProfile(stored, stored.updatedAt)

  const settings = await db.settings.toArray()
  const profile = healthProfileFromLegacySettings(
    new Map(settings.map((item) => [item.key, item.value])),
  )
  await db.healthProfiles.put(profile)
  return profile
}

export async function putHealthProfile(
  profile: HealthProfile | HealthProfilePatch,
): Promise<HealthProfile> {
  const existing = await db.healthProfiles.get('primary')
  const normalized = normalizeHealthProfile(
    {
      ...existing,
      ...profile,
      cycle: { ...existing?.cycle, ...profile.cycle },
      reproductive: { ...existing?.reproductive, ...profile.reproductive },
      wellbeing: { ...existing?.wellbeing, ...profile.wellbeing },
      biometrics: { ...existing?.biometrics, ...profile.biometrics },
      permissions: { ...existing?.permissions, ...profile.permissions },
      privacy: { ...existing?.privacy, ...profile.privacy },
      createdAt: profile.createdAt ?? existing?.createdAt,
      updatedAt: new Date().toISOString(),
    },
  )
  await db.healthProfiles.put(normalized)
  return normalized
}

/** All regimen entries, most recently started first. */
export async function getContraceptionRegimens(): Promise<ContraceptionRegimenEntry[]> {
  const entries = await db.contraceptionRegimens.toArray()
  return entries.sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
}

/** The regimen active on a given date, if any — for era-aware report/reminder interpretation. */
export function activeContraceptionRegimen(
  entries: ContraceptionRegimenEntry[],
  date: string,
): ContraceptionRegimenEntry | undefined {
  return entries.find((entry) => entry.startDate <= date && (!entry.endDate || entry.endDate >= date))
}

export async function addContraceptionRegimen(
  entry: Omit<ContraceptionRegimenEntry, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ContraceptionRegimenEntry> {
  const now = new Date().toISOString()
  const record: ContraceptionRegimenEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
  await db.contraceptionRegimens.put(record)
  return record
}

export async function updateContraceptionRegimen(
  id: string,
  patch: Partial<Omit<ContraceptionRegimenEntry, 'id' | 'createdAt'>>,
): Promise<void> {
  const existing = await db.contraceptionRegimens.get(id)
  if (!existing) return
  await db.contraceptionRegimens.put({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteContraceptionRegimen(id: string): Promise<void> {
  await db.contraceptionRegimens.delete(id)
}

/** Well-known settings keys. */
export const SK = {
  onboarded: 'onboarded',
  goal: 'goal',
  birthYear: 'birthYear',
  cycleLength: 'cycleLength',
  pregnancyLMP: 'pregnancyLMP',
  pinSalt: 'pinSalt',
  pinHash: 'pinHash',
  biometricLock: 'biometricLock',
  /** Legacy only: plaintext AI keys are migrated out, then removed. */
  aiKey: 'aiKey',
  aiProvider: 'aiProvider',
  aiModel: 'aiModel',
  aiBaseUrl: 'aiBaseUrl',
  aiConsent: 'aiConsent',
  /** 'strict' (zero data retention) or 'standard' (no-training only). */
  aiPrivacyTier: 'aiPrivacyTier',
  backupEndpoint: 'backupEndpoint',
  reminderEmail: 'reminderEmail',
  reminderTime: 'reminderTime',
  pinFailCount: 'pinFailCount',
  pinLockUntil: 'pinLockUntil',
  supportPromptShown: 'supportPromptShown',
  /** This device's own code for sharing its data out to a partner (sharer role). */
  partnerShareCode: 'partnerShareCode',
  /** A code entered on this device to view someone else's shared data (viewer role). */
  partnerViewCode: 'partnerViewCode',
  /** 'true' when this device is a read-only partner-viewer mirror, not a primary tracker. */
  partnerViewerMode: 'partnerViewerMode',
  partnerViewerLabel: 'partnerViewerLabel',
  partnerLastSyncedAt: 'partnerLastSyncedAt',
} as const
