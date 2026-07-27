import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StartupErrorBoundary } from './components/StartupErrorBoundary'
import { getSetting, setSetting, SK } from './db/schema'
import { initializeNativeRuntime } from './native/runtime'
import { Onboarding } from './screens/Onboarding'
import { useApp } from './state/appStore'
import './styles/base.css'
import './styles/app.css'
import './styles/health-import.css'

// Retire service workers left behind by pre-native development builds. Lunara
// no longer registers a PWA or depends on service-worker caching.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => undefined)
}

void initializeNativeRuntime(async () => {
  // Shown at most once, ever: the flag is persisted before the user has
  // even seen the prompt, so no interaction path (rate, support, dismiss,
  // or killing the app mid-prompt) can bring it back.
  if ((await getSetting(SK.supportPromptShown)) === '1') return false
  await setSetting(SK.supportPromptShown, '1')
  useApp.setState({ supportPromptOpen: true })
  return true
})

const onboardingPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === 'onboarding'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      {onboardingPreview ? (
        <Onboarding
          onDone={() => {
            window.location.assign('/')
          }}
        />
      ) : (
        <App />
      )}
    </StartupErrorBoundary>
  </React.StrictMode>,
)
