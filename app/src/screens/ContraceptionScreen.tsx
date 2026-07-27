import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  addContraceptionRegimen,
  deleteContraceptionRegimen,
  getContraceptionRegimens,
  updateContraceptionRegimen,
  type ContraceptionMethod,
} from '../db/schema'
import { CONTRACEPTION_METHOD_LABELS, CONTRACEPTION_RENEWAL_DAYS } from '../db/taxonomy'
import { addDays } from '../engine/cycle'
import { formatShort, localToday } from '../lib/dates'
import '../styles/health.css'

export interface ContraceptionScreenProps {
  onBack: () => void
}

const METHOD_OPTIONS = Object.entries(CONTRACEPTION_METHOD_LABELS).filter(
  ([id]) => id !== 'none' && id !== 'unknown' && id !== 'prefer-not-to-say',
) as [ContraceptionMethod, string][]

export function ContraceptionScreen({ onBack }: ContraceptionScreenProps) {
  const today = localToday()
  const entries = useLiveQuery(() => getContraceptionRegimens(), [])
  const [method, setMethod] = useState<ContraceptionMethod>('combined-pill-patch-ring')
  const [productName, setProductName] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [renewalDays, setRenewalDays] = useState<number | ''>(
    CONTRACEPTION_RENEWAL_DAYS['combined-pill-patch-ring'] ?? '',
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const active = entries?.filter((entry) => !entry.endDate)
  const past = entries?.filter((entry) => entry.endDate)

  function pickMethod(next: ContraceptionMethod) {
    setMethod(next)
    setRenewalDays(CONTRACEPTION_RENEWAL_DAYS[next] ?? '')
  }

  async function addEntry() {
    setError(null)
    if (!startDate) {
      setError('Add a start date.')
      return
    }
    const nextRenewalDate =
      typeof renewalDays === 'number' && renewalDays > 0 ? addDays(startDate, renewalDays) : undefined
    await addContraceptionRegimen({
      method,
      productName: productName.trim() || undefined,
      startDate,
      renewalIntervalDays: typeof renewalDays === 'number' ? renewalDays : undefined,
      nextRenewalDate,
      notes: notes.trim() || undefined,
    })
    setProductName('')
    setNotes('')
  }

  async function endEntry(id: string) {
    await updateContraceptionRegimen(id, { endDate: today })
  }

  return (
    <div className="health-overlay">
      <header className="health-topbar">
        <button className="health-icon-button" onClick={onBack} aria-label="Close">
          ‹
        </button>
        <div className="health-topbar-title">Contraception & medication</div>
        <span />
      </header>

      <div className="health-scroll">
        <main className="health-canvas">
          <section className="health-hero">
            <div className="health-kicker">Regimen history</div>
            <h1 className="health-display">Track what you're on, and since when.</h1>
            <p className="health-lede" style={{ marginTop: 12 }}>
              A dated record of method, start/stop, and renewal timing — separate from the
              per-day adherence notes in your daily log.
            </p>
          </section>

          <section className="health-panel">
            <div className="health-section-head" style={{ paddingTop: 0 }}>
              <h2>Current</h2>
              <span>{active?.length ?? 0} active</span>
            </div>
            {!active?.length && <p className="muted">No active regimen recorded.</p>}
            {active?.map((entry) => (
              <div className="setting-row" key={entry.id} style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ display: 'block' }}>
                    {CONTRACEPTION_METHOD_LABELS[entry.method]}
                    {entry.productName ? ` — ${entry.productName}` : ''}
                  </strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Since {formatShort(entry.startDate)}
                    {entry.nextRenewalDate ? ` · next renewal ${formatShort(entry.nextRenewalDate)}` : ''}
                  </span>
                  {entry.notes && (
                    <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                      {entry.notes}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="chip" onClick={() => void endEntry(entry.id)}>
                    End
                  </button>
                  <button
                    className="chip"
                    onClick={() => void deleteContraceptionRegimen(entry.id)}
                    aria-label="Delete entry"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="health-panel">
            <div className="health-section-head" style={{ paddingTop: 0 }}>
              <h2>Add a regimen</h2>
            </div>
            <div className="field">
              <label htmlFor="regimen-method">Method</label>
              <select
                id="regimen-method"
                value={method}
                onChange={(event) => pickMethod(event.target.value as ContraceptionMethod)}
              >
                {METHOD_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="regimen-product">Product name (optional)</label>
              <input
                id="regimen-product"
                type="text"
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="e.g. brand or generic name"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="regimen-start">Start date</label>
              <input
                id="regimen-start"
                type="date"
                value={startDate}
                max={today}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="regimen-renewal">Renewal interval, days (optional)</label>
              <input
                id="regimen-renewal"
                type="number"
                min={1}
                value={renewalDays}
                onChange={(event) =>
                  setRenewalDays(event.target.value ? Number(event.target.value) : '')
                }
                placeholder="e.g. 28 for pill/patch/ring, 90 for injection"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="regimen-notes">Notes (optional)</label>
              <input
                id="regimen-notes"
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            {error && (
              <p className="report-export-error" role="alert" style={{ marginTop: 8 }}>
                {error}
              </p>
            )}
            <button className="health-action" style={{ marginTop: 14 }} onClick={() => void addEntry()}>
              Add regimen
            </button>
          </section>

          {!!past?.length && (
            <section className="health-panel">
              <div className="health-section-head" style={{ paddingTop: 0 }}>
                <h2>Past</h2>
                <span>{past.length}</span>
              </div>
              {past.map((entry) => (
                <div className="setting-row" key={entry.id}>
                  <div>
                    <strong style={{ display: 'block' }}>
                      {CONTRACEPTION_METHOD_LABELS[entry.method]}
                      {entry.productName ? ` — ${entry.productName}` : ''}
                    </strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatShort(entry.startDate)} – {formatShort(entry.endDate!)}
                    </span>
                  </div>
                  <button
                    className="chip"
                    onClick={() => void deleteContraceptionRegimen(entry.id)}
                    aria-label="Delete entry"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </section>
          )}

          <p className="health-note">
            Stored locally, encrypted at rest, same as the rest of your data. Reports use this
            history to interpret bleeding patterns by era rather than only your current setting.
          </p>
        </main>
      </div>
    </div>
  )
}
