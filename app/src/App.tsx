import { App as NativeApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useState } from 'react'
import { CalendarScreen } from './components/CalendarScreen'
import { DoctorReport } from './components/DoctorReport'
import { LogSheet } from './components/LogSheet'
import { PinLock } from './components/PinLock'
import { TabBar } from './components/TabBar'
import { ensureHealthProfile, getHealthProfile, getSetting, SK } from './db/schema'
import { warmDbKey } from './db/encryption'
import { resolvePregnancyDating } from './engine/pregnancyDating'
import { ArticleScreen } from './screens/ArticleScreen'
import { Graphs } from './screens/Graphs'
import { Insights } from './screens/Insights'
import { Onboarding } from './screens/Onboarding'
import { Settings } from './screens/Settings'
import { Today } from './screens/Today'
import { isNative } from './native/runtime'
import {
  CycleReportScreen,
  PerimenopauseScreen,
  PregnancyDetailScreen,
  TrackerCustomizeScreen,
  TtcDetailScreen,
} from './screens/healthFeatures'
import { useApp } from './state/appStore'

// Lazy: pulls in the Anthropic/OpenAI SDKs, the largest deps in the bundle,
// and is only needed once the user opens the assistant.
const AssistantScreen = lazy(() =>
  import('./components/AssistantScreen').then((m) => ({ default: m.AssistantScreen })),
)

export default function App() {
  const {
    tab,
    setTab,
    sheetDate,
    sheetFocus,
    closeSheet,
    calendarOpen,
    assistantOpen,
    reportOpen,
    cycleReportOpen,
    setCycleReportOpen,
    pregnancyDetailOpen,
    setPregnancyDetailOpen,
    perimenopauseOpen,
    setPerimenopauseOpen,
    ttcDetailOpen,
    setTtcDetailOpen,
    trackerCustomizeOpen,
    setTrackerCustomizeOpen,
    locked,
    setLocked,
    articleSlug,
    setArticleSlug,
  } = useApp()

  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(false)

  useEffect(() => {
    // Persist legacy/fresh-install profile state outside Dexie's read-only
    // liveQuery context. getHealthProfile remains safe to call reactively.
    // Wait for the encryption key before the first Dexie write: otherwise
    // that write has to load the key (a native-bridge round-trip) AND
    // encrypt inside one Dexie.waitFor() window, which can outlast what
    // Dexie can keep the IndexedDB transaction alive for.
    void warmDbKey()
      .then(() => ensureHealthProfile())
      .catch((error: unknown) => {
        console.error('[Selenya startup] Could not persist the health profile migration.', error)
      })
  }, [])

  const flags = useLiveQuery(async () => {
    await warmDbKey()
    const [ob, pin, legacyPregnancyLmp, profile] = await Promise.all([
      getSetting(SK.onboarded),
      getSetting(SK.pinHash),
      getSetting(SK.pregnancyLMP),
      getHealthProfile(),
    ])
    const pregnancyLmp = profile.reproductive.pregnancyLmp ?? legacyPregnancyLmp
    const pregnancyDating =
      (profile.reproductive.pregnancyDating
        ? resolvePregnancyDating({
            method: profile.reproductive.pregnancyDating.method,
            date: profile.reproductive.pregnancyDating.inputDate,
            clinicianConfirmed:
              profile.reproductive.pregnancyDating.authority === 'clinician-assigned',
          })
        : undefined) ??
      (pregnancyLmp
        ? resolvePregnancyDating({
            method: 'lmp',
            date: pregnancyLmp,
          })
        : undefined)
    return { ob: ob === '1', hasPin: !!pin, pregnancyDating }
  }, [])

  useEffect(() => {
    if (flags === undefined) return
    setOnboarded(flags.ob)
    if (flags.hasPin) setLocked(true)
    setReady(true)
  }, [flags, setLocked])

  useEffect(() => {
    if (!isNative) return
    let listener: PluginListenerHandle | undefined
    void NativeApp.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive && (await getSetting(SK.pinHash))) setLocked(true)
    }).then((handle) => {
      listener = handle
    })
    return () => {
      void listener?.remove()
    }
  }, [setLocked])


  if (!ready) return <div className="page page-loading" role="status" aria-label="Loading Selenya" />
  if (!onboarded) return <Onboarding onDone={() => setOnboarded(true)} />
  if (locked) return <PinLock />

  return (
    <>
      <main>
        {tab === 'today' && <Today />}
        {tab === 'insights' && <Insights />}
        {tab === 'graphs' && <Graphs />}
        {tab === 'settings' && <Settings />}
      </main>
      <TabBar active={tab} onChange={setTab} />

      {sheetDate && (
        <LogSheet date={sheetDate} initialFocus={sheetFocus ?? undefined} onClose={closeSheet} />
      )}
      {calendarOpen && <CalendarScreen />}
      {assistantOpen && (
        <Suspense fallback={<div className="page page-loading" role="status" aria-label="Loading assistant" />}>
          <AssistantScreen />
        </Suspense>
      )}
      {reportOpen && <DoctorReport />}
      {cycleReportOpen && <CycleReportScreen onBack={() => setCycleReportOpen(false)} />}
      {pregnancyDetailOpen && flags?.pregnancyDating && (
        <PregnancyDetailScreen
          dating={flags.pregnancyDating}
          onBack={() => setPregnancyDetailOpen(false)}
        />
      )}
      {perimenopauseOpen && <PerimenopauseScreen onBack={() => setPerimenopauseOpen(false)} />}
      {ttcDetailOpen && <TtcDetailScreen onBack={() => setTtcDetailOpen(false)} />}
      {trackerCustomizeOpen && (
        <TrackerCustomizeScreen onBack={() => setTrackerCustomizeOpen(false)} />
      )}
      {articleSlug && <ArticleScreen slug={articleSlug} onClose={() => setArticleSlug(null)} />}
    </>
  )
}
