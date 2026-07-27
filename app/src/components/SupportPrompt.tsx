import { useApp } from '../state/appStore'

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.lunara.mobile'
const KOFI_URL = 'https://ko-fi.com/kshitijj'

/**
 * Shown at most once per install, on the way out of the app (see
 * main.tsx's onExitAttempt wiring) — never re-shown after that, regardless
 * of which button the user picks or whether they dismiss it.
 */
export function SupportPrompt() {
  const setSupportPromptOpen = useApp((s) => s.setSupportPromptOpen)
  const close = () => setSupportPromptOpen(false)

  return (
    <div className="support-prompt-overlay">
      <div className="support-prompt-card">
        <h2>Enjoying Selenya?</h2>
        <p className="muted">
          A rating helps other people find a private, local-first alternative. If Selenya has
          been useful to you, a small tip helps keep it maintained.
        </p>
        <div className="support-prompt-actions">
          <a className="cta" href={PLAY_STORE_URL} target="_blank" rel="noreferrer" onClick={close}>
            Rate on Play Store
          </a>
          <a
            className="support-prompt-secondary"
            href={KOFI_URL}
            target="_blank"
            rel="noreferrer"
            onClick={close}
          >
            Support on Ko-fi
          </a>
          <button className="support-prompt-dismiss" onClick={close}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
