import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import {
  generateRecoveryCode,
  hashPin,
  newSalt,
  normalizeRecoveryCode,
} from '../crypto/vault'
import {
  db,
  getHealthProfile,
  getSetting,
  putHealthProfile,
  removeSetting,
  setSetting,
  SK,
  type Goal,
  type HealthImportField,
  type PermissionState,
} from '../db/schema'
import type { Envelope } from '../crypto/vault'
import { applyImport, collectExport, decryptImport, encryptedExport, shareOrDownload } from '../db/transfer'
import { pushBackup, restoreBackup } from '../lib/backup'
import {
  deletePartnerSnapshot,
  pullPartnerSnapshot,
  pushPartnerSnapshot,
} from '../lib/partnerSharing'
import { formatShort, localToday } from '../lib/dates'
import { addDays } from '../engine/cycle'
import {
  parseReminderPreferences,
  REMINDER_DEFINITIONS,
  REMINDER_SETTINGS_KEY,
  serializeReminderPreferences,
  updateReminderPlan,
  withReminderGlobals,
  withReminderPermission,
  type ReminderPreferenceId,
  type ReminderPreferences,
} from '../engine/reminderPreferences'
import type { ReminderPermission } from '../engine/reminders'
import {
  resolvePregnancyDating,
  type PregnancyDatingMethod,
} from '../engine/pregnancyDating'
import {
  authenticateWithBiometrics,
  getBiometricStatus,
  type BiometricStatus,
} from '../native/biometrics'
import {
  getHealthPlatformStatus,
  importHealthData,
  requestHealthAccess,
  type HealthPlatformStatus,
} from '../native/health'
import {
  applyHealthSamples,
  clearHealthImports,
  healthImportProvider,
  importAppleHealthPeriodHistory,
  type HealthImportConflict,
} from '../native/healthImport'
import {
  cancelDailyReminder,
  cancelMaterializedReminders,
  notificationPermission,
  syncReminderPlans,
} from '../native/notifications'
import { isNative, nativePlatform } from '../native/runtime'
import {
  clearSecureSecrets,
  deleteSecureSecret,
  getSecureSecret,
  SECURE_SECRET_KEYS,
  secureVaultStatus,
} from '../native/secureVault'
import { getWidgetStatus, type WidgetStatus } from '../native/widgets'
import { useApp } from '../state/appStore'

const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function profileHealthPermission(
  authorization: HealthPlatformStatus['authorization'],
): PermissionState {
  if (authorization === 'granted' || authorization === 'partial') return 'granted'
  if (authorization === 'requested') return 'requested'
  if (authorization === 'denied') return 'denied'
  return 'not-requested'
}

function profileReminderPermission(permission: PermissionState): ReminderPermission {
  return permission === 'requested' ? 'not-requested' : permission
}

const HEALTH_IMPORT_FIELD_LABELS: Record<HealthImportField, string> = {
  flow: 'Flow',
  bbt: 'Basal body temperature',
  opk: 'Ovulation test',
  weightKg: 'Weight',
  sleepMinutes: 'Sleep',
  steps: 'Steps',
}

const GOAL_LABELS: Record<Goal, string> = {
  cycle: 'Cycle tracking',
  ttc: 'Trying to conceive',
  pregnancy: 'Pregnancy',
  peri: 'Perimenopause',
}

const PREGNANCY_DATING_OPTIONS: {
  method: PregnancyDatingMethod
  label: string
  dateLabel: string
}[] = [
  {
    method: 'clinician-edd',
    label: 'Due date assigned by my clinician',
    dateLabel: 'Clinician-assigned due date',
  },
  { method: 'lmp', label: 'First day of last period', dateLabel: 'First day of last period' },
  { method: 'conception', label: 'Conception date', dateLabel: 'Conception date' },
  {
    method: 'ivf-day-3',
    label: 'IVF day-3 embryo transfer',
    dateLabel: 'Day-3 embryo-transfer date',
  },
  {
    method: 'ivf-day-5',
    label: 'IVF day-5 embryo transfer',
    dateLabel: 'Day-5 embryo-transfer date',
  },
]

function pregnancyDateBounds(method: PregnancyDatingMethod) {
  const today = localToday()
  if (method === 'clinician-edd') {
    return { min: addDays(today, -21), max: addDays(today, 300) }
  }
  return { min: addDays(today, -300), max: today }
}

export function Settings() {
  const {
    setAssistantOpen,
    setCycleReportOpen,
    setPregnancyDetailOpen,
    setPerimenopauseOpen,
    setTtcDetailOpen,
    setTrackerCustomizeOpen,
    setContraceptionOpen,
  } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false)
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [hasOpenRouterKey, setHasOpenRouterKey] = useState(false)
  const [vaultLabel, setVaultLabel] = useState(isNative ? 'Checking…' : 'Session memory')
  const [biometrics, setBiometrics] = useState<BiometricStatus | null>(null)
  const [health, setHealth] = useState<HealthPlatformStatus | null>(null)
  const [importConflicts, setImportConflicts] = useState<HealthImportConflict[]>([])
  const [widget, setWidget] = useState<WidgetStatus | null>(null)
  const [capabilityBusy, setCapabilityBusy] = useState(false)
  const [reminderBusy, setReminderBusy] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [reminders, setReminders] = useState<ReminderPreferences | null>(null)
  const [pregnancyMethod, setPregnancyMethod] =
    useState<PregnancyDatingMethod>('lmp')

  useEffect(() => {
    let alive = true
    void Promise.all([
      getSecureSecret(SECURE_SECRET_KEYS.openAiApiKey),
      getSecureSecret(SECURE_SECRET_KEYS.anthropicApiKey),
      getSecureSecret(SECURE_SECRET_KEYS.openRouterApiKey),
      secureVaultStatus(),
      getBiometricStatus(),
      getHealthPlatformStatus(),
      getWidgetStatus(),
    ])
      .then(([openAiKey, anthropicKey, openRouterKey, vault, biometricStatus, healthStatus, widgetStatus]) => {
        if (!alive) return
        setHasOpenAiKey(Boolean(openAiKey))
        setHasAnthropicKey(Boolean(anthropicKey))
        setHasOpenRouterKey(Boolean(openRouterKey))
        setVaultLabel(
          vault.persistence === 'memory'
            ? 'Session memory'
            : `${vault.persistence}${vault.hardwareBacked ? ' · hardware protected' : ''}`,
        )
        setBiometrics(biometricStatus)
        setHealth(healthStatus)
        setWidget(widgetStatus)
      })
      .catch((reason: unknown) => {
        if (alive) setStatus(reason instanceof Error ? reason.message : 'Could not inspect native services.')
      })
    return () => {
      alive = false
    }
  }, [])

  const s = useLiveQuery(async () => {
    const [
      legacyPregnancyLmp,
      hasPin,
      biometricLock,
      provider,
      endpoint,
      code,
      time,
      reminderSettings,
      profile,
      partnerShareCode,
      partnerViewCode,
      partnerViewerMode,
      partnerViewerLabel,
      partnerLastSyncedAt,
      dailyLogCount,
    ] =
      await Promise.all([
        getSetting(SK.pregnancyLMP),
        getSetting(SK.pinHash),
        getSetting(SK.biometricLock),
        getSetting(SK.aiProvider),
        getSetting(SK.backupEndpoint),
        getSetting('recoveryCode'),
        getSetting(SK.reminderTime),
        getSetting(REMINDER_SETTINGS_KEY),
        getHealthProfile(),
        getSetting(SK.partnerShareCode),
        getSetting(SK.partnerViewCode),
        getSetting(SK.partnerViewerMode),
        getSetting(SK.partnerViewerLabel),
        getSetting(SK.partnerLastSyncedAt),
        db.dailyLogs.count(),
      ])
    const pregnancyLmp = profile.reproductive.pregnancyLmp ?? legacyPregnancyLmp
    const pregnancyDating =
      profile.reproductive.pregnancyDating ??
      (pregnancyLmp
        ? resolvePregnancyDating({
            method: 'lmp',
            date: pregnancyLmp,
          })
        : undefined)
    return {
      goal: profile.primaryGoal,
      profile,
      pregnancyDating,
      hasPin: !!hasPin,
      biometricLock: biometricLock === '1',
      provider: provider === 'openai' ? 'openai' : provider === 'openrouter' ? 'openrouter' : 'anthropic',
      endpoint: endpoint ?? '',
      recoveryCode: code ?? '',
      legacyReminderTime: time,
      reminderSettings,
      partnerShareCode: partnerShareCode ?? '',
      partnerViewCode: partnerViewCode ?? '',
      partnerViewerMode: partnerViewerMode === 'true',
      partnerViewerLabel: partnerViewerLabel ?? '',
      partnerLastSyncedAt: partnerLastSyncedAt ?? '',
      dailyLogCount,
    }
  }, [])

  useEffect(() => {
    if (s?.pregnancyDating?.method) {
      setPregnancyMethod(s.pregnancyDating.method)
    }
  }, [s?.pregnancyDating?.method])

  useEffect(() => {
    if (!s) return
    setReminders(
      parseReminderPreferences(s.reminderSettings, {
        timeZone: DEVICE_TIME_ZONE,
        startDate: localToday(),
        permission: profileReminderPermission(s.profile.permissions.notifications),
        legacyTime: s.legacyReminderTime,
      }),
    )
  }, [
    s?.legacyReminderTime,
    s?.profile.permissions.notifications,
    s?.reminderSettings,
  ])

  if (!s) return <div className="page" />
  const profileGoals = s.profile.goals
  const hasPregnancyDating = Boolean(s.pregnancyDating)
  const reminderPreferences =
    reminders ??
    parseReminderPreferences(s.reminderSettings, {
      timeZone: DEVICE_TIME_ZONE,
      startDate: localToday(),
      permission: profileReminderPermission(s.profile.permissions.notifications),
      legacyTime: s.legacyReminderTime,
    })
  const activeReminderCount = reminderPreferences.plans.filter((plan) => plan.enabled).length

  async function setGoal(g: Goal) {
    await Promise.all([
      setSetting(SK.goal, g),
      putHealthProfile({
        primaryGoal: g,
        goals: [g, ...profileGoals.filter((goal) => goal !== g)],
      }),
    ])
    setStatus(
      g === 'pregnancy' && !hasPregnancyDating
        ? 'Pregnancy mode selected. Add your current dating source below.'
        : `Mode set to ${GOAL_LABELS[g]}`,
    )
  }

  async function setPregnancyDate(method: PregnancyDatingMethod, value: string) {
    if (!value) {
      await Promise.all([
        removeSetting(SK.pregnancyLMP),
        putHealthProfile({
          reproductive: {
            pregnancyDating: undefined,
            pregnancyLmp: undefined,
          },
        }),
      ])
      setStatus('Pregnancy dating source cleared.')
      return
    }
    const dating = resolvePregnancyDating({
      method,
      date: value,
      clinicianConfirmed: method === 'clinician-edd',
    })
    await putHealthProfile({
      reproductive: {
        pregnancyDating: {
          ...dating,
          updatedAt: new Date().toISOString(),
        },
        pregnancyLmp: method === 'lmp' ? value : undefined,
      },
    })
    if (method === 'lmp') await setSetting(SK.pregnancyLMP, value)
    else await removeSetting(SK.pregnancyLMP)
    setStatus(
      dating.provisional
        ? 'Pregnancy timeline updated with a provisional estimate.'
        : 'Pregnancy timeline updated with the clinician-assigned due date.',
    )
  }

  async function exportPlain() {
    const payload = await collectExport()
    await shareOrDownload(`lunara-backup-${localToday()}.json`, JSON.stringify(payload, null, 2))
    setStatus('Exported. Save it somewhere safe.')
  }

  async function exportEncrypted() {
    const pass = prompt('Choose a passphrase to encrypt this file. You will need it to import.')
    if (!pass) return
    const env = await encryptedExport(pass)
    await shareOrDownload(`lunara-encrypted-${localToday()}.json`, JSON.stringify(env))
    setStatus('Encrypted export saved.')
  }

  async function onImportFile(file: File) {
    const text = await file.text()
    const parsed = JSON.parse(text)
    try {
      if (parsed.kdf && parsed.data) {
        const pass = prompt('Passphrase for this encrypted file:')
        if (!pass) return
        const n = await decryptImport(parsed as Envelope, pass)
        setStatus(`Imported ${n} days from encrypted file.`)
      } else {
        const n = await applyImport(parsed)
        setStatus(`Imported ${n} days.`)
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  async function setPin() {
    const pin = prompt('Choose a 4-digit PIN:')
    if (!pin || !/^\d{4}$/.test(pin)) {
      setStatus('PIN must be 4 digits.')
      return
    }
    const salt = newSalt()
    await setSetting(SK.pinSalt, salt)
    await setSetting(SK.pinHash, await hashPin(pin, salt))
    setStatus('PIN lock enabled.')
  }

  async function removePin() {
    await removeSetting(SK.pinHash)
    await removeSetting(SK.pinSalt)
    await removeSetting(SK.biometricLock)
    setStatus('PIN lock removed.')
  }

  async function toggleBiometricLock() {
    if (s!.biometricLock) {
      await removeSetting(SK.biometricLock)
      setStatus('Biometric unlock turned off.')
      return
    }
    if (!s!.hasPin) {
      setStatus('Set a PIN first so you always have a fallback.')
      return
    }
    const current = biometrics ?? (await getBiometricStatus())
    setBiometrics(current)
    if (!current.available || !current.enrolled) {
      setStatus(current.reason ?? 'No enrolled biometric is available on this device.')
      return
    }
    setCapabilityBusy(true)
    try {
      const result = await authenticateWithBiometrics('Confirm biometric unlock for Selenya')
      if (!result.authenticated) {
        setStatus('Biometric confirmation was cancelled.')
        return
      }
      await setSetting(SK.biometricLock, '1')
      setStatus('Biometric unlock enabled. Your PIN remains the fallback.')
    } finally {
      setCapabilityBusy(false)
    }
  }

  async function syncHealthData() {
    setCapabilityBusy(true)
    setStatus(null)
    try {
      let access = health ?? (await getHealthPlatformStatus())
      if (!access.available) {
        setStatus(access.reason ?? 'Health data import is not available on this device.')
        setHealth(access)
        return
      }
      access = await requestHealthAccess()
      setHealth(access)
      await recordHealthImportDecision(access.authorization)
      if (access.authorization === 'denied' || access.authorization === 'unavailable') {
        setStatus(access.reason ?? 'Health permission was not granted.')
        return
      }
      const provider = healthImportProvider(access)
      if (!provider) {
        setStatus('This device does not expose a supported health-data provider.')
        return
      }
      const today = localToday()
      const samples = await importHealthData({
        startDate: addDays(today, -365),
        endDate: today,
        types: access.grantedTypes.length ? access.grantedTypes : access.supportedTypes,
      })
      const result = await applyHealthSamples(samples, provider)
      setImportConflicts(result.skippedConflicts)
      if (!samples.length && access.platform === 'healthkit') {
        setStatus(
          'Apple Health returned no records. For privacy, iOS does not reveal whether access was denied or the selected categories are empty.',
        )
      } else {
        setStatus(
          `Reviewed ${result.uniqueSamples} health sample${result.uniqueSamples === 1 ? '' : 's'}; ${result.daysChanged} day${result.daysChanged === 1 ? '' : 's'} added or updated.${result.fieldsSkippedForUserData ? ` Kept ${result.fieldsSkippedForUserData} manually entered value${result.fieldsSkippedForUserData === 1 ? '' : 's'}.` : ''}`,
        )
      }
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Health import failed.')
    } finally {
      setCapabilityBusy(false)
    }
  }

  async function recordHealthImportDecision(
    authorization: HealthPlatformStatus['authorization'],
  ) {
    const profile = await getHealthProfile()
    const permission = profileHealthPermission(authorization)
    const state =
      authorization === 'denied'
        ? 'declined'
        : authorization === 'granted' ||
            authorization === 'partial' ||
            authorization === 'requested'
          ? 'granted'
          : 'not-requested'
    const consentLedger = profile.privacy.consentLedger
      .filter((decision) => decision.purpose !== 'health-import')
      .concat({
        purpose: 'health-import' as const,
        state,
        version: 1 as const,
        decidedAt: new Date().toISOString(),
      })
    await putHealthProfile({
      permissions: { healthData: permission },
      privacy: { consentLedger },
    })
  }

  async function importApplePeriods() {
    setCapabilityBusy(true)
    setStatus(null)
    try {
      const today = localToday()
      const result = await importAppleHealthPeriodHistory({
        startDate: addDays(today, -730),
        endDate: today,
      })
      const refreshed = await getHealthPlatformStatus()
      setHealth(refreshed)
      setImportConflicts(result.skippedConflicts)
      if (result.authorization !== 'unavailable') {
        await recordHealthImportDecision(result.authorization)
      }
      if (!result.available) {
        setStatus(result.reason ?? 'Apple Health period import is unavailable.')
      } else if (!result.periodSamples) {
        setStatus(
          'Apple Health returned no period records. For privacy, iOS does not reveal whether access was denied or Health has no menstrual-flow history.',
        )
      } else {
        setStatus(
          `Reviewed ${result.uniqueSamples} Apple Health period record${result.uniqueSamples === 1 ? '' : 's'}; ${result.daysChanged} day${result.daysChanged === 1 ? '' : 's'} added or updated.${result.fieldsSkippedForUserData ? ` Kept ${result.fieldsSkippedForUserData} manually entered period value${result.fieldsSkippedForUserData === 1 ? '' : 's'}.` : ''}`,
        )
      }
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Apple Health period import failed.')
    } finally {
      setCapabilityBusy(false)
    }
  }

  async function clearImportedHealthData() {
    setCapabilityBusy(true)
    setStatus(null)
    try {
      const result = await clearHealthImports()
      setImportConflicts([])
      setStatus(
        result.fieldsCleared
          ? `Cleared ${result.fieldsCleared} imported value${result.fieldsCleared === 1 ? '' : 's'} across ${result.daysChanged} day${result.daysChanged === 1 ? '' : 's'}. Manually entered values were not touched.`
          : 'No imported values to clear.',
      )
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Could not clear imported health data.')
    } finally {
      setCapabilityBusy(false)
    }
  }

  async function removeAiKey() {
    const provider = s?.provider ?? 'anthropic'
    const vaultKey =
      provider === 'anthropic'
        ? SECURE_SECRET_KEYS.anthropicApiKey
        : provider === 'openrouter'
          ? SECURE_SECRET_KEYS.openRouterApiKey
          : SECURE_SECRET_KEYS.openAiApiKey
    await deleteSecureSecret(vaultKey)
    await removeSetting(SK.aiKey)
    if (provider === 'anthropic') setHasAnthropicKey(false)
    else if (provider === 'openrouter') setHasOpenRouterKey(false)
    else setHasOpenAiKey(false)
    setStatus(
      provider === 'anthropic'
        ? 'Anthropic credential removed from this device. Revoke it in the Anthropic console to invalidate it everywhere.'
        : provider === 'openrouter'
          ? 'OpenRouter key removed from secure storage.'
          : 'OpenAI key removed from secure storage.',
    )
  }

  async function enableBackup() {
    const endpoint = prompt('Backup relay URL (your deployed Selenya backup Worker):', s!.endpoint)
    if (!endpoint) return
    let code = s!.recoveryCode
    if (!code) {
      code = generateRecoveryCode()
      await setSetting('recoveryCode', code)
      alert(`Your recovery code, write it down, it is shown only once:\n\n${code}\n\nWithout it, backups cannot be restored.`)
    }
    await setSetting(SK.backupEndpoint, endpoint)
    try {
      await pushBackup(endpoint, code)
      setStatus('Backed up (zero-knowledge, the server cannot read it).')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Backup failed.')
    }
  }

  async function restore() {
    const endpoint = prompt('Backup relay URL:', s!.endpoint)
    if (!endpoint) return
    const code = prompt('Enter your recovery code:')
    if (!code) return
    try {
      const n = await restoreBackup(endpoint, normalizeRecoveryCode(code))
      await setSetting('recoveryCode', normalizeRecoveryCode(code))
      await setSetting(SK.backupEndpoint, endpoint)
      setStatus(`Restored ${n} days.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Restore failed.')
    }
  }

  async function startPartnerSharing() {
    const endpoint = prompt('Backup relay URL (same Worker as backup):', s!.endpoint || '')
    if (!endpoint) return
    let code = s!.partnerShareCode
    if (!code) {
      code = generateRecoveryCode()
      await setSetting(SK.partnerShareCode, code)
      alert(
        `Your partner-sharing code, shown once:\n\n${code}\n\nAnyone with this code can see everything you log — periods, symptoms, mood, notes, all of it. Only share it with someone you trust, the same way you'd treat a password.`,
      )
    }
    await setSetting(SK.backupEndpoint, endpoint)
    try {
      await pushPartnerSnapshot(endpoint, code)
      await setSetting(SK.partnerLastSyncedAt, new Date().toISOString())
      setStatus('Synced. Your partner can now view this with the code.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Partner sync failed.')
    }
  }

  async function resyncPartnerSharing() {
    if (!s!.endpoint || !s!.partnerShareCode) return
    try {
      await pushPartnerSnapshot(s!.endpoint, s!.partnerShareCode)
      await setSetting(SK.partnerLastSyncedAt, new Date().toISOString())
      setStatus('Synced.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Partner sync failed.')
    }
  }

  async function stopPartnerSharing() {
    if (!confirm('Stop sharing your data with your partner? Their app will keep the last synced copy until they stop viewing it.')) {
      return
    }
    if (s!.endpoint && s!.partnerShareCode) {
      await deletePartnerSnapshot(s!.endpoint, s!.partnerShareCode).catch(() => {})
    }
    await removeSetting(SK.partnerShareCode)
    setStatus('Partner sharing turned off.')
  }

  async function viewPartnerData() {
    const endpoint = prompt('Backup relay URL your partner used:', s!.endpoint || '')
    if (!endpoint) return
    const codeInput = prompt("Enter the code your partner gave you:")
    if (!codeInput) return
    const code = normalizeRecoveryCode(codeInput)

    if (
      s!.dailyLogCount > 0 &&
      !confirm(
        `This device already has ${s!.dailyLogCount} of your own logged day${s!.dailyLogCount === 1 ? '' : 's'}. Viewing a partner's shared data merges their days into this same local database — your own entries are kept, but the two histories will be mixed together on this device from now on. Continue?`,
      )
    ) {
      return
    }

    try {
      const n = await pullPartnerSnapshot(endpoint, code)
      const label = prompt("What should this be labeled (e.g. a name)?", '') || ''
      await setSetting(SK.partnerViewCode, code)
      await setSetting(SK.backupEndpoint, endpoint)
      await setSetting(SK.partnerViewerMode, 'true')
      await setSetting(SK.partnerViewerLabel, label)
      await setSetting(SK.partnerLastSyncedAt, new Date().toISOString())
      setStatus(`Now viewing ${label || 'their'} cycle (${n} days synced).`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not sync partner data.')
    }
  }

  async function stopViewingPartner() {
    await removeSetting(SK.partnerViewCode)
    await removeSetting(SK.partnerViewerMode)
    await removeSetting(SK.partnerViewerLabel)
    setStatus('Stopped viewing partner data. Their last-synced entries stay on this device until you delete them.')
  }

  async function saveReminderPreferences(
    next: ReminderPreferences,
    requestPermission = false,
  ) {
    setReminderBusy(true)
    setStatus(null)
    try {
      const hasEnabledPlans = next.plans.some((plan) => plan.enabled)
      let prepared = next
      let permission = profileReminderPermission(s!.profile.permissions.notifications)

      if (isNative && hasEnabledPlans) {
        permission = await notificationPermission(requestPermission)
        prepared = withReminderPermission(next, permission)
      } else if (!isNative) {
        permission = 'not-requested'
        prepared = withReminderPermission(next, permission)
      }

      setReminders(prepared)
      await setSetting(REMINDER_SETTINGS_KEY, serializeReminderPreferences(prepared))

      // Retire the single legacy alarm after the first edit; preferences have
      // already been migrated into the cycle preset above.
      await cancelDailyReminder()
      await Promise.all([
        removeSetting(SK.reminderEmail),
        removeSetting(SK.reminderTime),
      ])

      if (isNative) {
        if (!hasEnabledPlans || permission !== 'granted') {
          await cancelMaterializedReminders()
        } else {
          await syncReminderPlans(prepared.plans, {
            now: new Date(),
            horizonDays: 30,
            limit: 64,
          })
        }

        if (permission !== 'not-requested') {
          const consentLedger = s!.profile.privacy.consentLedger
            .filter((decision) => decision.purpose !== 'notifications')
            .concat({
              purpose: 'notifications' as const,
              state: permission === 'granted' ? 'granted' as const : 'declined' as const,
              version: 1 as const,
              decidedAt: new Date().toISOString(),
            })
          await putHealthProfile({
            permissions: { notifications: permission },
            privacy: { consentLedger },
          })
        }
      }

      if (!isNative) {
        setStatus(
          'Saved locally. Native alarms will be scheduled when these preferences are used in the iOS or Android app.',
        )
      } else if (hasEnabledPlans && permission === 'denied') {
        setStatus('Saved locally, but notifications are blocked in your device settings.')
      } else if (hasEnabledPlans) {
        setStatus('Private reminder schedule updated on this device.')
      } else {
        setStatus('All local reminders are off.')
      }
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Could not update local reminders.')
    } finally {
      setReminderBusy(false)
    }
  }

  function changeReminderPlan(
    id: ReminderPreferenceId,
    changes: { enabled?: boolean; localTime?: string },
    requestPermission = false,
  ) {
    void saveReminderPreferences(
      updateReminderPlan(reminderPreferences, id, changes),
      requestPermission,
    )
  }

  function changeReminderGlobals(changes: {
    privatePreviews?: boolean
    quietHours?: {
      enabled?: boolean
      start?: string
      end?: string
    }
  }) {
    void saveReminderPreferences(
      withReminderGlobals(reminderPreferences, changes),
    )
  }

  async function wipe() {
    if (!confirm('Delete ALL Selenya data on this device? This cannot be undone.')) return
    await clearSecureSecrets()
    await db.delete()
    location.reload()
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      {status && (
        <div className="card" style={{ background: 'var(--rose-100)', fontSize: 14 }}>
          {status}
        </div>
      )}

      <Section title="Goal">
        {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
          <button key={g} className="setting-row" onClick={() => setGoal(g)}>
            <span>{GOAL_LABELS[g]}</span>
            <span style={{ color: 'var(--rose-500)' }}>{s.goal === g ? '●' : '○'}</span>
          </button>
        ))}
      </Section>

      <Section title="Personalize">
        <button className="setting-row" onClick={() => setTrackerCustomizeOpen(true)}>
          <span>Customize daily trackers</span>
          <span className="muted">reorder &amp; hide ›</span>
        </button>
        <button className="setting-row" onClick={() => setCycleReportOpen(true)}>
          <span>Cycle report &amp; patterns</span>
          <span className="muted">›</span>
        </button>
        <button className="setting-row" onClick={() => setContraceptionOpen(true)}>
          <span>Contraception &amp; medication history</span>
          <span className="muted">›</span>
        </button>
        {s.goal === 'pregnancy' && (
          <>
            <form
              className="setting-pregnancy-form"
              onSubmit={(event) => {
                event.preventDefault()
                const input = event.currentTarget.elements.namedItem('pregnancyDate')
                if (input instanceof HTMLInputElement) {
                  void setPregnancyDate(pregnancyMethod, input.value)
                }
              }}
            >
              <label className="setting-row setting-date-row">
                <span>Dating source</span>
                <select
                  name="pregnancyDatingMethod"
                  value={pregnancyMethod}
                  onChange={(event) =>
                    setPregnancyMethod(event.currentTarget.value as PregnancyDatingMethod)
                  }
                  aria-label="Pregnancy dating source"
                  style={{
                    maxWidth: '58%',
                    border: 0,
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    textAlign: 'right',
                  }}
                >
                  {PREGNANCY_DATING_OPTIONS.map((option) => (
                    <option value={option.method} key={option.method}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-row setting-date-row">
                <span>
                  {PREGNANCY_DATING_OPTIONS.find(
                    (option) => option.method === pregnancyMethod,
                  )?.dateLabel ?? 'Pregnancy date'}
                </span>
                <input
                  key={`${pregnancyMethod}-${s.pregnancyDating?.inputDate ?? ''}`}
                  name="pregnancyDate"
                  type="date"
                  min={pregnancyDateBounds(pregnancyMethod).min}
                  max={pregnancyDateBounds(pregnancyMethod).max}
                  defaultValue={
                    s.pregnancyDating?.method === pregnancyMethod
                      ? s.pregnancyDating.inputDate
                      : ''
                  }
                  aria-label="Date used for the pregnancy timeline"
                />
              </label>
              {s.pregnancyDating && (
                <div className="setting-row static-row">
                  <span>Current dating status</span>
                  <span className="muted">
                    {s.pregnancyDating.provisional
                      ? 'Provisional estimate'
                      : 'Clinician assigned'}
                  </span>
                </div>
              )}
              <button className="setting-row setting-date-save" type="submit">
                <span>Update pregnancy timeline</span>
                <span className="muted">Save</span>
              </button>
            </form>
            <button
              className="setting-row"
              disabled={!s.pregnancyDating}
              onClick={() => setPregnancyDetailOpen(true)}
            >
              <span>Pregnancy week &amp; checklist</span>
              <span className="muted">{s.pregnancyDating ? '›' : 'add dating source first'}</span>
            </button>
          </>
        )}
        {s.goal === 'ttc' && (
          <button className="setting-row" onClick={() => setTtcDetailOpen(true)}>
            <span>TTC daily guide</span>
            <span className="muted">›</span>
          </button>
        )}
        {s.goal === 'peri' && (
          <button className="setting-row" onClick={() => setPerimenopauseOpen(true)}>
            <span>Perimenopause timeline</span>
            <span className="muted">›</span>
          </button>
        )}
      </Section>

      <Section title="Privacy & lock">
        <button className="setting-row" onClick={s.hasPin ? removePin : setPin}>
          <span>PIN lock</span>
          <span className="muted">{s.hasPin ? 'On, tap to remove' : 'Off'}</span>
        </button>
        {isNative && (
          <button className="setting-row" disabled={capabilityBusy} onClick={toggleBiometricLock}>
            <span>Biometric unlock</span>
            <span className="muted">
              {s.biometricLock
                ? 'On'
                : biometrics?.available
                  ? 'Available ›'
                  : 'Unavailable'}
            </span>
          </button>
        )}
        <div className="setting-row static-row">
          <span>Secret storage</span>
          <span className="muted">{vaultLabel}</span>
        </div>
      </Section>

      {isNative && (
        <Section title="Device health & native services">
          {nativePlatform === 'ios' && (
            <button className="setting-row" disabled={capabilityBusy} onClick={importApplePeriods}>
              <span>Import period history from Apple Health</span>
              <span className="muted">{capabilityBusy ? 'Working…' : 'Up to 2 years ›'}</span>
            </button>
          )}
          <button className="setting-row" disabled={capabilityBusy} onClick={syncHealthData}>
            <span>
              {health?.platform === 'healthkit'
                ? 'Import other Apple Health data'
                : health?.platform === 'health-connect'
                  ? 'Import from Health Connect'
                  : 'Health data import'}
            </span>
            <span className="muted">
              {capabilityBusy
                ? 'Working…'
                : health?.available
                  ? health.authorization === 'granted'
                    ? 'Connected ›'
                    : health.authorization === 'requested'
                      ? 'Requested ›'
                      : 'Connect ›'
                  : 'Unavailable'}
            </span>
          </button>
          <div className="setting-row static-row">
            <span>Home-screen widget</span>
            <span className="muted">
              {widget?.available ? 'Available' : widget?.publisherAvailable ? 'Native extension pending' : 'Unavailable'}
            </span>
          </div>
          <p className="muted" style={{ padding: '8px 0' }}>
            Health imports are read-only, permission-scoped, and copied into your local Selenya
            timeline. Manual entries are never silently replaced, and nothing is uploaded by this
            step.
          </p>
          {importConflicts.length > 0 && (
            <div style={{ padding: '4px 0 8px' }}>
              <div className="section-label" style={{ marginBottom: 4 }}>
                Kept your entry over the import
              </div>
              <p className="muted" style={{ marginBottom: 6 }}>
                These days already had a value you entered yourself, so the imported value was not
                applied:
              </p>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {importConflicts.slice(0, 20).map((conflict, index) => (
                  <li key={`${conflict.date}-${conflict.field}-${index}`}>
                    {formatShort(conflict.date)} — {HEALTH_IMPORT_FIELD_LABELS[conflict.field]}
                  </li>
                ))}
              </ul>
              {importConflicts.length > 20 && (
                <p className="muted" style={{ marginTop: 4 }}>
                  and {importConflicts.length - 20} more.
                </p>
              )}
            </div>
          )}
          <button
            className="setting-row"
            disabled={capabilityBusy}
            onClick={() => void clearImportedHealthData()}
          >
            <span>Clear imported health data</span>
            <span className="muted">keeps manual entries ›</span>
          </button>
        </Section>
      )}

      <Section title="Your data & encrypted backup">
        <button className="setting-row" onClick={exportPlain}>
          <span>Export a backup file</span>
          <span className="muted">›</span>
        </button>
        <button className="setting-row" onClick={exportEncrypted}>
          <span>Export encrypted</span>
          <span className="muted">›</span>
        </button>
        <button className="setting-row" onClick={() => fileInput.current?.click()}>
          <span>Import from file</span>
          <span className="muted">›</span>
        </button>
        <button className="setting-row" onClick={enableBackup}>
          <span>Encrypted cloud backup</span>
          <span className="muted">zero-knowledge ›</span>
        </button>
        <button className="setting-row" onClick={restore}>
          <span>Restore from backup</span>
          <span className="muted">›</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])}
        />
      </Section>

      <Section title="Partner sharing">
        <p className="muted" style={{ padding: '8px 0' }}>
          Read-only mirror over the same zero-knowledge relay as backup: your partner sees a full
          copy of what you log, and can't edit it. Nothing is uploaded unencrypted, and the relay
          never gets the code needed to decrypt it.
        </p>
        {s.partnerShareCode ? (
          <>
            <div className="setting-row static-row">
              <span>Sharing is on</span>
              <span className="muted">
                {s.partnerLastSyncedAt ? `Last synced ${formatShort(s.partnerLastSyncedAt)}` : 'Not synced yet'}
              </span>
            </div>
            <button className="setting-row" onClick={() => void resyncPartnerSharing()}>
              <span>Sync now</span>
              <span className="muted">›</span>
            </button>
            <button className="setting-row" onClick={() => alert(s.partnerShareCode)}>
              <span>Show sharing code again</span>
              <span className="muted">›</span>
            </button>
            <button
              className="setting-row"
              onClick={() => void stopPartnerSharing()}
              style={{ color: 'var(--red-500)' }}
            >
              <span>Stop sharing</span>
              <span>›</span>
            </button>
          </>
        ) : (
          <button className="setting-row" onClick={() => void startPartnerSharing()}>
            <span>Share my data with a partner</span>
            <span className="muted">›</span>
          </button>
        )}
        {s.partnerViewerMode ? (
          <>
            <div className="setting-row static-row">
              <span>Viewing {s.partnerViewerLabel || "partner's"} data</span>
              <span className="muted">
                {s.partnerLastSyncedAt ? `Last synced ${formatShort(s.partnerLastSyncedAt)}` : ''}
              </span>
            </div>
            <button
              className="setting-row"
              onClick={() => void stopViewingPartner()}
              style={{ color: 'var(--red-500)' }}
            >
              <span>Stop viewing partner data</span>
              <span>›</span>
            </button>
          </>
        ) : (
          <button className="setting-row" onClick={() => void viewPartnerData()}>
            <span>View a partner's shared data</span>
            <span className="muted">›</span>
          </button>
        )}
      </Section>

      <div className="reminder-settings-section">
        <div className="section-label" style={{ marginBottom: 4 }}>
          Local reminders
        </div>
        <div className="card reminder-console">
          <div className="reminder-console-heading">
            <div>
              <span className="reminder-kicker">QUIETLY ON YOUR DEVICE</span>
              <h3>{activeReminderCount ? `${activeReminderCount} active` : 'Your time, your rhythm'}</h3>
              <p>
                {isNative
                  ? 'No account or server is used to deliver these notifications.'
                  : 'Set your preferences here; the native iOS and Android shells deliver them.'}
              </p>
            </div>
            <span
              className={`reminder-status-pill ${
                s.profile.permissions.notifications === 'denied' ? 'is-blocked' : ''
              }`}
            >
              {reminderBusy
                ? 'Saving…'
                : !isNative
                  ? 'Local'
                  : s.profile.permissions.notifications === 'denied'
                    ? 'Blocked'
                    : activeReminderCount
                      ? 'Ready'
                      : 'Off'}
            </span>
          </div>

          <div className="reminder-privacy-controls">
            <label className="reminder-privacy-row">
              <span>
                <strong>Private previews</strong>
                <small>
                  {reminderPreferences.privatePreviews
                    ? 'Lock screens show one neutral sentence.'
                    : 'Use broad category wording, never results or predictions.'}
                </small>
              </span>
              <span className="reminder-switch">
                <input
                  type="checkbox"
                  checked={reminderPreferences.privatePreviews}
                  disabled={reminderBusy}
                  onChange={(event) =>
                    changeReminderGlobals({ privatePreviews: event.currentTarget.checked })
                  }
                  aria-label="Use private reminder previews"
                />
                <span aria-hidden="true" />
              </span>
            </label>

            <div className="reminder-quiet-block">
              <label className="reminder-privacy-row">
                <span>
                  <strong>Quiet hours</strong>
                  <small>Anything inside this window moves to the end time.</small>
                </span>
                <span className="reminder-switch">
                  <input
                    type="checkbox"
                    checked={reminderPreferences.quietHours.enabled}
                    disabled={reminderBusy}
                    onChange={(event) =>
                      changeReminderGlobals({
                        quietHours: { enabled: event.currentTarget.checked },
                      })
                    }
                    aria-label="Enable quiet hours"
                  />
                  <span aria-hidden="true" />
                </span>
              </label>
              {reminderPreferences.quietHours.enabled && (
                <div className="reminder-quiet-times">
                  <label>
                    <span>From</span>
                    <input
                      type="time"
                      value={reminderPreferences.quietHours.start}
                      disabled={reminderBusy}
                      onChange={(event) =>
                        changeReminderGlobals({
                          quietHours: { start: event.currentTarget.value },
                        })
                      }
                    />
                  </label>
                  <span aria-hidden="true">→</span>
                  <label>
                    <span>Until</span>
                    <input
                      type="time"
                      value={reminderPreferences.quietHours.end}
                      disabled={reminderBusy}
                      onChange={(event) =>
                        changeReminderGlobals({
                          quietHours: { end: event.currentTarget.value },
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="reminder-plan-list">
            {REMINDER_DEFINITIONS.map((definition, index) => {
              const plan = reminderPreferences.plans.find(
                (candidate) => candidate.id === `settings-${definition.id}`,
              )
              if (!plan) return null
              return (
                <div
                  className={`reminder-plan ${plan.enabled ? 'is-enabled' : ''}`}
                  key={definition.id}
                  style={{ '--reminder-index': index } as React.CSSProperties}
                >
                  <span className="reminder-monogram" aria-hidden="true">
                    {definition.monogram}
                  </span>
                  <span className="reminder-plan-copy">
                    <strong>{definition.label}</strong>
                    <small>
                      {definition.detail} · {definition.cadence}
                    </small>
                  </span>
                  <label className="reminder-time-field">
                    <span className="sr-only">{definition.label} reminder time</span>
                    <input
                      type="time"
                      value={plan.localTime}
                      disabled={reminderBusy || !plan.enabled}
                      onChange={(event) =>
                        changeReminderPlan(definition.id, {
                          localTime: event.currentTarget.value,
                        })
                      }
                      aria-label={`${definition.label} reminder time`}
                    />
                  </label>
                  <label className="reminder-switch">
                    <input
                      type="checkbox"
                      checked={plan.enabled}
                      disabled={reminderBusy}
                      onChange={(event) =>
                        changeReminderPlan(
                          definition.id,
                          { enabled: event.currentTarget.checked },
                          event.currentTarget.checked,
                        )
                      }
                      aria-label={`${plan.enabled ? 'Disable' : 'Enable'} ${definition.label}`}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
              )
            })}
          </div>

          <p className="reminder-footnote">
            Estimates, tests, and medication logs stay informational. A notification never confirms
            fertility, pregnancy, contraception protection, or a diagnosis.
          </p>
        </div>
      </div>

      <Section title="AI assistant">
        <button className="setting-row" onClick={() => setAssistantOpen(true)}>
          <span>Open Selenya AI</span>
          <span className="muted">
            {s.provider === 'anthropic'
              ? hasAnthropicKey
                ? 'Anthropic connected ›'
                : 'add Anthropic key ›'
              : s.provider === 'openrouter'
                ? hasOpenRouterKey
                  ? 'OpenRouter connected ›'
                  : 'add OpenRouter key ›'
                : hasOpenAiKey
                  ? 'OpenAI key secured ›'
                  : 'add OpenAI key ›'}
          </span>
        </button>
        {(s.provider === 'anthropic'
          ? hasAnthropicKey
          : s.provider === 'openrouter'
            ? hasOpenRouterKey
            : hasOpenAiKey) && (
          <button className="setting-row" onClick={removeAiKey}>
            <span>Remove saved credential</span>
            <span className="muted">›</span>
          </button>
        )}
      </Section>

      <Section title="Danger zone" danger>
        <button className="setting-row" onClick={wipe} style={{ color: 'var(--red-500)' }}>
          <span>Delete all data</span>
          <span>›</span>
        </button>
      </Section>

      <Section title="About & contact">
        <p className="muted" style={{ padding: '14px 0', lineHeight: 1.6 }}>
          Selenya exists because reproductive-health data shouldn’t be a big company’s product to
          mine. It’s built by one person who cares about that, not a company optimizing your cycle
          for engagement or ad targeting. Selenya will never go behind a paywall.
        </p>
        <button
          className="setting-row"
          aria-expanded={contactOpen}
          onClick={() => setContactOpen((o) => !o)}
        >
          <span>Contact & links</span>
          <span className="muted">{contactOpen ? '⌃' : '⌄'}</span>
        </button>
        {contactOpen && (
          <>
            <a className="setting-row" href="mailto:kshitij.j615@gmail.com">
              <span>Email — collaborate or report a problem</span>
              <span className="muted">›</span>
            </a>
            <a className="setting-row" href="https://kshitijj.me" target="_blank" rel="noreferrer">
              <span>Website</span>
              <span className="muted">kshitijj.me ›</span>
            </a>
            <a
              className="setting-row"
              href="https://github.com/kshitij406"
              target="_blank"
              rel="noreferrer"
            >
              <span>GitHub</span>
              <span className="muted">kshitij406 ›</span>
            </a>
            <a
              className="setting-row"
              href="https://linkedin.com/in/kshitij-jha2006"
              target="_blank"
              rel="noreferrer"
            >
              <span>LinkedIn</span>
              <span className="muted">›</span>
            </a>
            <a
              className="setting-row"
              href="https://instagram.com/kxitiz_"
              target="_blank"
              rel="noreferrer"
            >
              <span>Instagram</span>
              <span className="muted">kxitiz_ ›</span>
            </a>
            <a
              className="setting-row"
              href="https://ko-fi.com/kshitijj"
              target="_blank"
              rel="noreferrer"
            >
              <span>Support on Ko-fi</span>
              <span className="muted">›</span>
            </a>
          </>
        )}
      </Section>

      <p className="muted" style={{ textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
        Selenya is open source (AGPL-3.0) and not affiliated with Flo Health Inc. Not a medical
        device. Removing the app deletes its local history, keep an encrypted backup.
        <br />
        <a href="https://github.com/kshitij406/selenya" target="_blank" rel="noreferrer">
          Source code
        </a>
      </p>
    </div>
  )
}

function Section({
  title,
  children,
  danger,
}: {
  title: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <div>
      <div className={`section-label${danger ? ' section-label-danger' : ''}`} style={{ marginBottom: 4 }}>
        {title}
      </div>
      <div className={`card${danger ? ' card-danger' : ''}`} style={{ padding: '0 16px' }}>
        {children}
      </div>
    </div>
  )
}
