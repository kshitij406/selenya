import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import {
  normalizeTrackerCustomization,
  TRACKER_CUSTOMIZATION_KEY,
} from '../content/trackerCatalog'
import {
  clearHealthImportProvenance,
  dailyLogHasEntry,
  db,
  getHealthProfile,
  getSetting,
  normalizeDailyLog,
  type ActivityEvent,
  type DailyLog,
  type DigestionEvent,
  type Discharge,
  type Flow,
  type HealthImportField,
  type IntimacyEvent,
  type LegacySexEvent,
  type LifestyleEvent,
  type SafetyCheckIn,
  type SymptomImpairment,
  type SymptomRating,
  type SymptomSeverity,
} from '../db/schema'
import { buildSafetyTriageInput, evaluateSafetyTriage, type PregnancySafetyStatus } from '../engine/safety'
import {
  ACTIVITY_EVENTS,
  DIGESTION_EVENTS,
  DISCHARGES,
  FLOWS,
  LIFESTYLE_EVENTS,
  MOODS,
  PREGNANCY_TEST_RESULTS,
  SEX_OPTIONS,
  SYMPTOM_IMPAIRMENTS,
  SYMPTOM_SEVERITIES,
  SYMPTOMS,
  TRACKER_GROUPS,
} from '../db/taxonomy'
import { formatLong } from '../lib/dates'
import { nativeTap } from '../native/runtime'
import type { TrackerFocus } from '../state/appStore'
import { usePartnerMode } from '../state/partnerMode'
import { SafetyBanner } from './SafetyBanner'
import { Sheet } from './Sheet'

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

const SAFETY_TOGGLES: { id: keyof SafetyCheckIn; label: string }[] = [
  { id: 'heavySoakingTwoHoursPlus', label: 'Soaking a pad/tampon hourly, 2+ hrs' },
  { id: 'dizziness', label: 'Dizziness' },
  { id: 'lightheadedness', label: 'Lightheadedness' },
  { id: 'chestPain', label: 'Chest pain' },
  { id: 'shortnessOfBreath', label: 'Trouble breathing' },
  { id: 'bleedingBetweenPeriods', label: 'Bleeding between periods' },
  { id: 'bleedingAfterMenopause', label: 'Bleeding after menopause' },
  { id: 'suddenSeverePelvicPain', label: 'Sudden severe pelvic pain' },
  { id: 'persistentOrRecurringPelvicPain', label: 'Pelvic pain that keeps recurring' },
]

const PREGNANCY_SAFETY_TOGGLES: { id: keyof SafetyCheckIn; label: string }[] = [
  { id: 'pregnancyVaginalBleeding', label: 'Vaginal bleeding' },
  { id: 'pregnancyPelvicPain', label: 'Pelvic pain' },
  { id: 'pregnancyFainting', label: 'Fainting' },
  { id: 'pregnancyShoulderPain', label: 'Shoulder pain' },
]

interface LabeledOption<T extends string> {
  id: T
  label: string
}

const HEALTH_IMPORT_PROVIDER_LABELS: Record<string, string> = {
  'apple-health': 'Apple Health',
  'health-connect': 'Health Connect',
}

/** Shown next to a field's label so the user knows a value came from an import, not their own entry, before they edit it away. */
function ImportBadge({ log, field }: { log: DailyLog; field: HealthImportField }) {
  const provenance = log.healthImports?.[field]
  if (!provenance) return null
  return (
    <span className="chip" style={{ fontSize: 10, padding: '2px 8px', opacity: 0.75 }}>
      Imported · {HEALTH_IMPORT_PROVIDER_LABELS[provenance.provider] ?? provenance.provider}
    </span>
  )
}

function filteredOptions<T extends string>(
  query: string,
  sectionLabel: string,
  options: readonly LabeledOption<T>[],
): readonly LabeledOption<T>[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized || sectionLabel.toLocaleLowerCase().includes(normalized)) return options
  return options.filter((option) => option.label.toLocaleLowerCase().includes(normalized))
}

function filteredStrings(query: string, sectionLabel: string, options: readonly string[]): string[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized || sectionLabel.toLocaleLowerCase().includes(normalized)) return [...options]
  return options.filter((option) => option.toLocaleLowerCase().includes(normalized))
}

function sectionMatches(query: string, ...terms: string[]): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  return !normalized || terms.some((term) => term.toLocaleLowerCase().includes(normalized))
}

function structuredSelection<T extends string>(
  canonical: T[] | undefined,
  legacyEvents: string[] | undefined,
  options: readonly LabeledOption<T>[],
): T[] {
  if (canonical !== undefined) return canonical
  const legacy = new Set(legacyEvents ?? [])
  return options.filter((option) => legacy.has(option.label)).map((option) => option.id)
}

function mirrorStructuredSelection<T extends string>(
  events: string[] | undefined,
  selected: T[],
  options: readonly LabeledOption<T>[],
): string[] | undefined {
  const optionLabels = new Set(options.map((option) => option.label))
  const retained = (events ?? []).filter((event) => !optionLabels.has(event))
  const labels = selected.flatMap((id) => {
    const label = options.find((option) => option.id === id)?.label
    return label ? [label] : []
  })
  const next = [...retained, ...labels]
  return next.length ? next : undefined
}

function isLegacySexEvent(value: IntimacyEvent): value is LegacySexEvent {
  return (
    value === 'protected' ||
    value === 'unprotected' ||
    value === 'high-drive' ||
    value === 'low-drive'
  )
}

export function LogSheet({
  date,
  initialFocus,
  onClose,
}: {
  date: string
  initialFocus?: TrackerFocus
  onClose: () => void
}) {
  const partnerMode = usePartnerMode()
  const existing = useLiveQuery(() => db.dailyLogs.get(date), [date])
  const customizationJSON = useLiveQuery(() => getSetting(TRACKER_CUSTOMIZATION_KEY), [])
  const [draft, setDraft] = useState<DailyLog>({ date })
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (existing !== undefined && loadedFor !== date) {
      setDraft(normalizeDailyLog(existing ?? { date }))
      setLoadedFor(date)
    }
  }, [existing, date, loadedFor])

  useEffect(() => {
    if (!initialFocus || loadedFor !== date) return
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`tracker-${initialFocus}`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [date, initialFocus, loadedFor])

  let storedCustomization: unknown
  try {
    storedCustomization = customizationJSON ? JSON.parse(customizationJSON) : undefined
  } catch {
    storedCustomization = undefined
  }
  const customization = normalizeTrackerCustomization(storedCustomization)
  const isVisible = (id: string) => !customization.hidden.includes(id)
  const sectionStyle = (id: string) => ({ order: customization.order.indexOf(id) })

  const healthProfile = useLiveQuery(() => getHealthProfile(), [])
  const pregnancyStatus: PregnancySafetyStatus = healthProfile?.reproductive.pregnancyDating
    ? 'confirmed'
    : healthProfile?.primaryGoal === 'pregnancy'
      ? 'confirmed'
      : draft.pregnancyTest === 'positive' || draft.pregnancyTest === 'faint'
        ? 'possible'
        : 'none'

  const toggleSafety = (id: keyof SafetyCheckIn) => {
    void nativeTap()
    const current = draft.safetyCheckIn ?? {}
    const next = { ...current, [id]: !current[id] }
    setDraft({ ...draft, safetyCheckIn: next })
  }

  const safetyResult = evaluateSafetyTriage(
    buildSafetyTriageInput(draft.safetyCheckIn, { pregnancyStatus }),
  )

  async function save() {
    if (!dailyLogHasEntry(draft)) await db.dailyLogs.delete(date)
    else await db.dailyLogs.put(draft)
    onClose()
  }

  function updateSymptomRating(
    symptom: string,
    key: keyof SymptomRating,
    value: SymptomSeverity | SymptomImpairment,
  ) {
    const current = draft.symptomRatings ?? {}
    const rating = current[symptom] ?? {}
    const nextRating = {
      ...rating,
      [key]: rating[key] === value ? undefined : value,
    }
    const nextRatings = { ...current, [symptom]: nextRating }
    if (!nextRating.severity && !nextRating.impairment) delete nextRatings[symptom]
    setDraft({ ...draft, symptomRatings: Object.keys(nextRatings).length ? nextRatings : undefined })
  }

  function toggleSymptom(symptom: string) {
    const symptoms = toggle(draft.symptoms ?? [], symptom)
    const symptomRatings = { ...(draft.symptomRatings ?? {}) }
    if (!symptoms.includes(symptom)) delete symptomRatings[symptom]
    setDraft({
      ...draft,
      symptoms: symptoms.length ? symptoms : undefined,
      symptomRatings: Object.keys(symptomRatings).length ? symptomRatings : undefined,
    })
  }

  function toggleIntimacy(event: IntimacyEvent) {
    let selected = toggle(draft.intimacyEvents ?? [], event)
    const partneredEvents: IntimacyEvent[] = [
      'protected',
      'unprotected',
      'oral',
      'anal',
      'sensual-touch',
    ]
    const driveEvents: IntimacyEvent[] = ['neutral-drive', 'high-drive', 'low-drive']
    if (selected.includes(event)) {
      if (event === 'no-sex') selected = selected.filter((item) => !partneredEvents.includes(item))
      if (partneredEvents.includes(event)) selected = selected.filter((item) => item !== 'no-sex')
      if (driveEvents.includes(event)) {
        selected = selected.filter((item) => item === event || !driveEvents.includes(item))
      }
    }
    const sex = selected.find(isLegacySexEvent)
    setDraft({
      ...draft,
      intimacyEvents: selected,
      sex,
    })
  }

  function toggleDigestion(event: DigestionEvent) {
    const current = structuredSelection(draft.digestion, draft.events, DIGESTION_EVENTS)
    const digestion = toggle(current, event)
    setDraft({
      ...draft,
      digestion,
      events: mirrorStructuredSelection(draft.events, digestion, DIGESTION_EVENTS),
    })
  }

  function toggleActivity(event: ActivityEvent) {
    const current = structuredSelection(draft.activities, draft.events, ACTIVITY_EVENTS)
    let activities = toggle(current, event)
    if (activities.includes(event)) {
      if (event === 'no-exercise') activities = ['no-exercise']
      else activities = activities.filter((item) => item !== 'no-exercise')
    }
    setDraft({
      ...draft,
      activities,
      events: mirrorStructuredSelection(draft.events, activities, ACTIVITY_EVENTS),
    })
  }

  function toggleLifestyle(event: LifestyleEvent) {
    const current = structuredSelection(draft.lifestyle, draft.events, LIFESTYLE_EVENTS)
    const lifestyle = toggle(current, event)
    setDraft({
      ...draft,
      lifestyle,
      events: mirrorStructuredSelection(draft.events, lifestyle, LIFESTYLE_EVENTS),
    })
  }

  const visibleFlows = filteredOptions(query, 'Period flow', FLOWS)
  const visibleSymptoms = filteredStrings(query, 'Symptoms severity routine impact', SYMPTOMS)
  const visibleMoods = filteredStrings(query, 'Mood', MOODS)
  const visibleDischarges = filteredOptions(query, 'Discharge', DISCHARGES)
  const visibleIntimacy = filteredOptions(query, 'Sex and sex drive intimacy', SEX_OPTIONS)
  const visiblePregnancyTests = filteredOptions(
    query,
    'Pregnancy test fertility',
    PREGNANCY_TEST_RESULTS,
  )
  const visibleDigestion = filteredOptions(query, 'Digestion appetite stool', DIGESTION_EVENTS)
  const visibleActivities = filteredOptions(query, 'Movement activity exercise', ACTIVITY_EVENTS)
  const visibleLifestyle = filteredOptions(query, 'Daily context lifestyle', LIFESTYLE_EVENTS)

  if (partnerMode.active) {
    const summary: [string, string][] = []
    if (draft.flow) summary.push(['Flow', draft.flow])
    if (draft.symptoms?.length) summary.push(['Symptoms', draft.symptoms.join(', ')])
    if (draft.moods?.length) summary.push(['Mood', draft.moods.join(', ')])
    if (draft.discharge) summary.push(['Discharge', draft.discharge])
    if (draft.bbt !== undefined) summary.push(['BBT', `${(draft.bbt / 100).toFixed(2)}°C`])
    if (draft.opk) summary.push(['Ovulation test', draft.opk])
    if (draft.pregnancyTest) summary.push(['Pregnancy test', draft.pregnancyTest])
    if (draft.notes) summary.push(['Notes', draft.notes])

    return (
      <Sheet title={formatLong(date)} onClose={onClose}>
        <div className="field" style={{ order: -1 }}>
          <p className="muted">
            You're viewing {partnerMode.label} data on this device — read-only. Logging happens on
            their device and appears here after the next sync.
          </p>
          {summary.length === 0 ? (
            <p className="muted">Nothing logged for this day.</p>
          ) : (
            <div className="card" style={{ marginTop: 8 }}>
              {summary.map(([label, value]) => (
                <div key={label} className="setting-row static-row">
                  <span>{label}</span>
                  <span className="muted">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={formatLong(date)} onClose={onClose}>
      <div className="field" style={{ order: -2 }}>
        <label htmlFor="tracker-search">Find a tracker</label>
        <input
          id="tracker-search"
          type="search"
          autoComplete="off"
          placeholder="Search symptoms, tests, activity…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div
        className="log-group"
        style={{
          order: -1,
          background: draft.checkInComplete
            ? 'linear-gradient(135deg, var(--teal-100), var(--surface-raised))'
            : undefined,
        }}
      >
        <div className="spread">
          <div>
            <div className="section-label">Check-in coverage</div>
            <div className="muted" style={{ marginTop: 3 }}>
              Mark this after you have reviewed today—even if nothing needs logging.
            </div>
          </div>
          <button
            type="button"
            className="chip teal"
            aria-pressed={draft.checkInComplete === true}
            onClick={() => {
              void nativeTap()
              setDraft({
                ...draft,
                checkInComplete: draft.checkInComplete ? undefined : true,
              })
            }}
          >
            {draft.checkInComplete ? '✓ Complete' : 'Mark complete'}
          </button>
        </div>
      </div>

      <div className="log-group" style={{ order: -0.5 }}>
        <div className="section-label">Any of these right now?</div>
        <div className="muted" style={{ marginTop: 3, marginBottom: 10 }}>
          Optional. Answers here are used only for a local, non-diagnostic care-level check —
          nothing is sent anywhere.
        </div>
        <div className="chip-wrap">
          {SAFETY_TOGGLES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="chip"
              aria-pressed={Boolean(draft.safetyCheckIn?.[t.id])}
              onClick={() => toggleSafety(t.id)}
            >
              {t.label}
            </button>
          ))}
          {pregnancyStatus !== 'none' &&
            PREGNANCY_SAFETY_TOGGLES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip"
                aria-pressed={Boolean(draft.safetyCheckIn?.[t.id])}
                onClick={() => toggleSafety(t.id)}
              >
                {t.label}
              </button>
            ))}
          <button
            type="button"
            className="chip"
            aria-pressed={Boolean(draft.safetyCheckIn?.thoughtsOfSelfHarm)}
            onClick={() => toggleSafety('thoughtsOfSelfHarm')}
          >
            Thoughts of self-harm
          </button>
        </div>
        {safetyResult.urgency !== 'none' && (
          <div style={{ marginTop: 12 }}>
            <SafetyBanner result={safetyResult} />
          </div>
        )}
      </div>

      {isVisible('flow') && visibleFlows.length > 0 && (
        <div id="tracker-flow" className="tracker-section" style={sectionStyle('flow')}>
          <div className="spread">
            <div className="section-label">Flow</div>
            <ImportBadge log={draft} field="flow" />
          </div>
          <div className="chip-wrap">
            {visibleFlows.map((f) => (
              <button
                key={f.id}
                className="chip"
                aria-pressed={draft.flow === f.id}
                onClick={() =>
                  (void nativeTap(),
                  setDraft({
                    ...clearHealthImportProvenance(draft, 'flow'),
                    flow: draft.flow === f.id ? undefined : (f.id as Flow),
                  }))
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isVisible('symptoms') && visibleSymptoms.length > 0 && (
        <div id="tracker-symptoms" className="tracker-section" style={sectionStyle('symptoms')}>
          <div className="section-label">Symptoms</div>
          <div className="chip-wrap">
            {visibleSymptoms.map((s) => (
              <button
                key={s}
                className="chip"
                aria-pressed={(draft.symptoms ?? []).includes(s)}
                onClick={() => toggleSymptom(s)}
              >
                {s}
              </button>
            ))}
          </div>
          {(draft.symptoms ?? [])
            .filter(
              (symptom) =>
                !query.trim() ||
                symptom.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ||
                'symptoms severity routine impact'.includes(query.trim().toLocaleLowerCase()),
            )
            .map((symptom) => {
              const rating = draft.symptomRatings?.[symptom]
              return (
                <div
                  key={`${symptom}-detail`}
                  className="log-group"
                  style={{ padding: 13, boxShadow: 'none' }}
                >
                  <div className="spread">
                    <strong>{symptom}</strong>
                    <span className="muted">Optional detail</span>
                  </div>
                  <div className="muted" style={{ marginTop: 10 }}>
                    Intensity
                  </div>
                  <div className="chip-wrap" style={{ marginTop: 6 }}>
                    {SYMPTOM_SEVERITIES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="chip"
                        aria-pressed={rating?.severity === option.id}
                        onClick={() => updateSymptomRating(symptom, 'severity', option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="muted" style={{ marginTop: 10 }}>
                    Effect on your routine
                  </div>
                  <div className="chip-wrap" style={{ marginTop: 6 }}>
                    {SYMPTOM_IMPAIRMENTS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="chip"
                        aria-pressed={rating?.impairment === option.id}
                        onClick={() => updateSymptomRating(symptom, 'impairment', option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {isVisible('mood') && visibleMoods.length > 0 && (
        <div className="tracker-section" style={sectionStyle('mood')}>
          <div className="section-label">Mood</div>
          <div className="chip-wrap">
            {visibleMoods.map((m) => (
              <button
                key={m}
                className="chip"
                aria-pressed={(draft.moods ?? []).includes(m)}
                onClick={() => setDraft({ ...draft, moods: toggle(draft.moods ?? [], m) })}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {isVisible('discharge') && visibleDischarges.length > 0 && (
        <div className="tracker-section" style={sectionStyle('discharge')}>
          <div className="section-label">Discharge</div>
          <div className="chip-wrap">
            {visibleDischarges.map((d) => (
              <button
                key={d.id}
                className="chip"
                aria-pressed={draft.discharge === d.id}
                onClick={() =>
                  setDraft({
                    ...draft,
                    discharge: draft.discharge === d.id ? undefined : (d.id as Discharge),
                  })
                }
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isVisible('intimacy') && visibleIntimacy.length > 0 && (
        <div id="tracker-intimacy" className="tracker-section" style={sectionStyle('intimacy')}>
          <div className="section-label">Sex &amp; drive</div>
          <div className="muted">Choose every item that applies. These entries stay on your device.</div>
          <div className="chip-wrap">
            {visibleIntimacy.map((s) => (
              <button
                key={s.id}
                className="chip"
                aria-pressed={(draft.intimacyEvents ?? []).includes(s.id)}
                onClick={() => toggleIntimacy(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isVisible('fertility') &&
        (visiblePregnancyTests.length > 0 ||
          sectionMatches(
            query,
            'fertility',
            'basal body temperature bbt',
            'ovulation test opk',
            'pregnancy test',
          )) && (
        <div className="tracker-section" style={sectionStyle('fertility')}>
          <div className="section-label">Fertility</div>
          <div className="row">
            {sectionMatches(query, 'fertility', 'basal body temperature bbt') && (
              <div className="field" style={{ flex: 1 }}>
                <div className="spread" style={{ alignItems: 'baseline' }}>
                  <label htmlFor="bbt">BBT (°C)</label>
                  <ImportBadge log={draft} field="bbt" />
                </div>
                <input
                  id="bbt"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="34"
                  max="42"
                  placeholder="36.50"
                  value={draft.bbt !== undefined ? (draft.bbt / 100).toFixed(2) : ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setDraft({
                      ...clearHealthImportProvenance(draft, 'bbt'),
                      bbt: v === '' ? undefined : Math.round(parseFloat(v) * 100),
                    })
                  }}
                />
              </div>
            )}
            {sectionMatches(query, 'fertility', 'ovulation test opk') && (
              <div className="field" style={{ flex: 1 }}>
                <div className="spread" style={{ alignItems: 'baseline' }}>
                  <label>Ovulation test</label>
                  <ImportBadge log={draft} field="opk" />
                </div>
                <div className="chip-wrap">
                  {(['positive', 'negative'] as const).map((o) => (
                    <button
                      key={o}
                      className="chip teal"
                      aria-pressed={draft.opk === o}
                      onClick={() =>
                        setDraft({
                          ...clearHealthImportProvenance(draft, 'opk'),
                          opk: draft.opk === o ? undefined : o,
                        })
                      }
                    >
                      {o === 'positive' ? 'Positive' : 'Negative'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {visiblePregnancyTests.length > 0 && (
            <div className="field">
              <label>Pregnancy test</label>
              <div className="chip-wrap">
                {visiblePregnancyTests.map((option) => (
                  <button
                    key={option.id}
                    className="chip"
                    aria-pressed={draft.pregnancyTest === option.id}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        pregnancyTest:
                          draft.pregnancyTest === option.id ? undefined : option.id,
                      })
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isVisible('digestion') && visibleDigestion.length > 0 && (
        <div className="log-group" style={sectionStyle('digestion')}>
          <div className="spread">
            <div>
              <div className="section-label">Digestion</div>
              <div className="muted" style={{ marginTop: 3 }}>
                Appetite, nausea, bloating, and stool changes
              </div>
            </div>
            <span className="log-group-dot violet" aria-hidden="true" />
          </div>
          <div className="chip-wrap" style={{ marginTop: 10 }}>
            {visibleDigestion.map((option) => (
              <button
                key={option.id}
                className="chip"
                aria-pressed={structuredSelection(
                  draft.digestion,
                  draft.events,
                  DIGESTION_EVENTS,
                ).includes(option.id)}
                onClick={() => {
                  void nativeTap()
                  toggleDigestion(option.id)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isVisible('movement') && visibleActivities.length > 0 && (
        <div className="log-group" style={sectionStyle('movement')}>
          <div className="spread">
            <div>
              <div className="section-label">Movement</div>
              <div className="muted" style={{ marginTop: 3 }}>
                Choose every activity that applies
              </div>
            </div>
            <span className="log-group-dot teal" aria-hidden="true" />
          </div>
          <div className="chip-wrap" style={{ marginTop: 10 }}>
            {visibleActivities.map((option) => (
              <button
                key={option.id}
                className="chip teal"
                aria-pressed={structuredSelection(
                  draft.activities,
                  draft.events,
                  ACTIVITY_EVENTS,
                ).includes(option.id)}
                onClick={() => {
                  void nativeTap()
                  toggleActivity(option.id)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isVisible('wellbeing') && visibleLifestyle.length > 0 && (
        <div className="log-group" style={sectionStyle('wellbeing')}>
          <div className="spread">
            <div>
              <div className="section-label">Daily context</div>
              <div className="muted" style={{ marginTop: 3 }}>
                Context for your own patterns—not a medical conclusion
              </div>
            </div>
            <span className="log-group-dot sun" aria-hidden="true" />
          </div>
          <div className="chip-wrap" style={{ marginTop: 10 }}>
            {visibleLifestyle.map((option) => (
              <button
                key={option.id}
                className="chip"
                aria-pressed={structuredSelection(
                  draft.lifestyle,
                  draft.events,
                  LIFESTYLE_EVENTS,
                ).includes(option.id)}
                onClick={() => {
                  void nativeTap()
                  toggleLifestyle(option.id)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {TRACKER_GROUPS.filter((group) => isVisible(group.id))
        .map((group) => ({
          group,
          items: filteredStrings(query, `${group.label} ${group.description}`, group.items),
        }))
        .filter(({ items }) => items.length > 0)
        .map(({ group, items }) => (
          <div className="log-group" key={group.id} style={sectionStyle(group.id)}>
            <div className="spread">
              <div>
                <div className="section-label">{group.label}</div>
                <div className="muted" style={{ marginTop: 3 }}>
                  {group.description}
                </div>
              </div>
              <span className={`log-group-dot ${group.tone}`} aria-hidden="true" />
            </div>
            <div className="chip-wrap" style={{ marginTop: 10 }}>
              {items.map((event) => (
                <button
                  key={event}
                  className={`chip ${group.tone === 'teal' ? 'teal' : ''}`}
                  aria-pressed={(draft.events ?? []).includes(event)}
                  onClick={() => {
                    void nativeTap()
                    setDraft({ ...draft, events: toggle(draft.events ?? [], event) })
                  }}
                >
                  {event}
                </button>
              ))}
            </div>
          </div>
        ))}

      {isVisible('measurements') &&
        sectionMatches(query, 'daily measurements', 'weight', 'water', 'sleep', 'steps') && (
        <div className="tracker-section" style={sectionStyle('measurements')}>
          <div className="section-label">Daily measurements</div>
          <div className="measurement-grid">
        <div className="field">
          <div className="spread" style={{ alignItems: 'baseline' }}>
            <label htmlFor="weight">Weight (kg)</label>
            <ImportBadge log={draft} field="weightKg" />
          </div>
          <input
            id="weight"
            type="number"
            inputMode="decimal"
            min="20"
            max="350"
            step="0.1"
            value={draft.weightKg ?? ''}
            onChange={(e) =>
              setDraft({
                ...clearHealthImportProvenance(draft, 'weightKg'),
                weightKg: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="water">Water (ml)</label>
          <input
            id="water"
            type="number"
            inputMode="numeric"
            min="0"
            step="50"
            value={draft.waterMl ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, waterMl: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>
        <div className="field">
          <div className="spread" style={{ alignItems: 'baseline' }}>
            <label htmlFor="sleep">Sleep (minutes)</label>
            <ImportBadge log={draft} field="sleepMinutes" />
          </div>
          <input
            id="sleep"
            type="number"
            inputMode="numeric"
            min="0"
            max="1440"
            value={draft.sleepMinutes ?? ''}
            onChange={(e) =>
              setDraft({
                ...clearHealthImportProvenance(draft, 'sleepMinutes'),
                sleepMinutes: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </div>
        <div className="field">
          <div className="spread" style={{ alignItems: 'baseline' }}>
            <label htmlFor="steps">Steps</label>
            <ImportBadge log={draft} field="steps" />
          </div>
          <input
            id="steps"
            type="number"
            inputMode="numeric"
            min="0"
            value={draft.steps ?? ''}
            onChange={(e) =>
              setDraft({
                ...clearHealthImportProvenance(draft, 'steps'),
                steps: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </div>
          </div>
        </div>
      )}

      {isVisible('notes') && sectionMatches(query, 'notes', 'journal free-form context') && (
        <div className="tracker-section" style={sectionStyle('notes')}>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              rows={2}
              value={draft.notes ?? ''}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
            />
          </div>
        </div>
      )}

      <button className="cta" style={{ order: 999 }} onClick={save}>
        {draft.checkInComplete ? 'Save complete check-in' : 'Save check-in'}
      </button>
    </Sheet>
  )
}
