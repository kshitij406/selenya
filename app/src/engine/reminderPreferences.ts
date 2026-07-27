import type {
  QuietHours,
  ReminderPermission,
  ReminderPlan,
  ReminderPreview,
} from './reminders'

export const REMINDER_SETTINGS_KEY = 'reminderPlansV1'

export type ReminderPreferenceId =
  | 'cycle'
  | 'contraception'
  | 'medication'
  | 'bbt'
  | 'opk'
  | 'pregnancy'
  | 'lifestyle'

export interface ReminderDefinition {
  id: ReminderPreferenceId
  label: string
  detail: string
  monogram: string
  cadence: 'Daily' | 'Weekly'
  defaultTime: string
  plan: Pick<ReminderPlan, 'kind' | 'route' | 'recurrence'>
}

export interface ReminderPreferences {
  version: 1
  privatePreviews: boolean
  quietHours: QuietHours
  plans: ReminderPlan[]
}

export const REMINDER_DEFINITIONS: readonly ReminderDefinition[] = [
  {
    id: 'cycle',
    label: 'Cycle check-in',
    detail: 'Log or review your cycle',
    monogram: 'C',
    cadence: 'Daily',
    defaultTime: '20:30',
    plan: {
      kind: 'period-log',
      route: 'today',
      recurrence: { type: 'daily' },
    },
  },
  {
    id: 'contraception',
    label: 'Contraception routine',
    detail: 'A private routine prompt',
    monogram: 'Rx',
    cadence: 'Daily',
    defaultTime: '09:00',
    plan: {
      kind: 'contraception-pill',
      route: 'today',
      recurrence: { type: 'daily' },
    },
  },
  {
    id: 'medication',
    label: 'Medication',
    detail: 'Your scheduled routine',
    monogram: 'M',
    cadence: 'Daily',
    defaultTime: '09:00',
    plan: {
      kind: 'medication',
      route: 'today',
      recurrence: { type: 'daily' },
    },
  },
  {
    id: 'bbt',
    label: 'Basal temperature',
    detail: 'Measure before getting up',
    monogram: '°',
    cadence: 'Daily',
    defaultTime: '07:00',
    plan: {
      kind: 'bbt',
      route: 'today',
      recurrence: { type: 'daily' },
    },
  },
  {
    id: 'opk',
    label: 'Ovulation test',
    detail: 'Log the result you observe',
    monogram: 'O',
    cadence: 'Daily',
    defaultTime: '14:00',
    plan: {
      kind: 'opk',
      route: 'today',
      recurrence: { type: 'daily' },
    },
  },
  {
    id: 'pregnancy',
    label: 'Pregnancy week',
    detail: 'Your weekly local update',
    monogram: 'W',
    cadence: 'Weekly',
    defaultTime: '09:00',
    plan: {
      kind: 'pregnancy-week',
      route: 'pregnancy',
      recurrence: { type: 'weekdays', weekdays: [1] },
    },
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle check-in',
    detail: 'Movement, sleep, water, notes',
    monogram: 'L',
    cadence: 'Daily',
    defaultTime: '20:00',
    plan: {
      kind: 'journaling',
      route: 'today',
      recurrence: { type: 'daily' },
    },
  },
] as const

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const PERMISSIONS = new Set<ReminderPermission>(['not-requested', 'granted', 'denied'])

function copyPreview(isPrivate: boolean): ReminderPreview {
  return { mode: isPrivate ? 'private' : 'category' }
}

function copyQuietHours(quietHours: QuietHours): QuietHours {
  return { ...quietHours }
}

function buildPlan(
  definition: ReminderDefinition,
  timeZone: string,
  startDate: string,
  permission: ReminderPermission,
  quietHours: QuietHours,
  privatePreviews: boolean,
): ReminderPlan {
  const recurrence = { ...definition.plan.recurrence, startDate }
  return {
    id: `settings-${definition.id}`,
    kind: definition.plan.kind,
    enabled: false,
    permission,
    localTime: definition.defaultTime,
    timeZone,
    recurrence,
    quietHours: copyQuietHours(quietHours),
    preview: copyPreview(privatePreviews),
    route: definition.plan.route,
  }
}

export function defaultReminderPreferences(options: {
  timeZone: string
  startDate: string
  permission?: ReminderPermission
  legacyTime?: string
}): ReminderPreferences {
  const privatePreviews = true
  const quietHours: QuietHours = { enabled: true, start: '22:00', end: '07:00' }
  const permission = options.permission ?? 'not-requested'
  const plans = REMINDER_DEFINITIONS.map((definition) =>
    buildPlan(
      definition,
      options.timeZone,
      options.startDate,
      permission,
      quietHours,
      privatePreviews,
    ),
  )
  if (options.legacyTime && TIME_RE.test(options.legacyTime)) {
    const cycle = plans.find((plan) => plan.id === 'settings-cycle')
    if (cycle) {
      cycle.enabled = true
      cycle.localTime = options.legacyTime
    }
  }
  return { version: 1, privatePreviews, quietHours, plans }
}

function normalizedQuietHours(value: unknown, fallback: QuietHours): QuietHours {
  if (!value || typeof value !== 'object') return copyQuietHours(fallback)
  const candidate = value as Partial<QuietHours>
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    start:
      typeof candidate.start === 'string' && TIME_RE.test(candidate.start)
        ? candidate.start
        : fallback.start,
    end:
      typeof candidate.end === 'string' && TIME_RE.test(candidate.end)
        ? candidate.end
        : fallback.end,
  }
}

/**
 * Parse persisted reminder settings defensively. Recurrence and kind stay tied
 * to the reviewed presets; only user-editable state is restored.
 */
export function parseReminderPreferences(
  raw: string | undefined,
  options: {
    timeZone: string
    startDate: string
    permission?: ReminderPermission
    legacyTime?: string
  },
): ReminderPreferences {
  const fallback = defaultReminderPreferences(options)
  if (!raw) return fallback

  try {
    const decoded = JSON.parse(raw) as Partial<ReminderPreferences>
    const privatePreviews =
      typeof decoded.privatePreviews === 'boolean'
        ? decoded.privatePreviews
        : fallback.privatePreviews
    const quietHours = normalizedQuietHours(decoded.quietHours, fallback.quietHours)
    const persisted = Array.isArray(decoded.plans) ? decoded.plans : []
    const plans = fallback.plans.map((defaultPlan) => {
      const saved = persisted.find((plan) => plan?.id === defaultPlan.id)
      const permission =
        saved && PERMISSIONS.has(saved.permission) ? saved.permission : defaultPlan.permission
      return {
        ...defaultPlan,
        enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : defaultPlan.enabled,
        permission,
        localTime:
          typeof saved?.localTime === 'string' && TIME_RE.test(saved.localTime)
            ? saved.localTime
            : defaultPlan.localTime,
        // Follow the device's current IANA zone so a saved wall-clock time
        // stays local after travel or a timezone-settings change.
        timeZone: options.timeZone,
        quietHours: copyQuietHours(quietHours),
        preview: copyPreview(privatePreviews),
        occurrenceRecords:
          saved?.occurrenceRecords && typeof saved.occurrenceRecords === 'object'
            ? saved.occurrenceRecords
            : undefined,
      }
    })
    return { version: 1, privatePreviews, quietHours, plans }
  } catch {
    return fallback
  }
}

export function withReminderPermission(
  preferences: ReminderPreferences,
  permission: ReminderPermission,
): ReminderPreferences {
  return {
    ...preferences,
    plans: preferences.plans.map((plan) => ({ ...plan, permission })),
  }
}

export function withReminderGlobals(
  preferences: ReminderPreferences,
  changes: {
    privatePreviews?: boolean
    quietHours?: Partial<QuietHours>
  },
): ReminderPreferences {
  const privatePreviews = changes.privatePreviews ?? preferences.privatePreviews
  const quietHours = {
    ...preferences.quietHours,
    ...changes.quietHours,
  }
  return {
    ...preferences,
    privatePreviews,
    quietHours,
    plans: preferences.plans.map((plan) => ({
      ...plan,
      quietHours: copyQuietHours(quietHours),
      preview: copyPreview(privatePreviews),
    })),
  }
}

export function updateReminderPlan(
  preferences: ReminderPreferences,
  id: ReminderPreferenceId,
  changes: Pick<Partial<ReminderPlan>, 'enabled' | 'localTime'>,
): ReminderPreferences {
  return {
    ...preferences,
    plans: preferences.plans.map((plan) =>
      plan.id === `settings-${id}` ? { ...plan, ...changes } : plan,
    ),
  }
}

export function serializeReminderPreferences(preferences: ReminderPreferences): string {
  return JSON.stringify(preferences)
}
