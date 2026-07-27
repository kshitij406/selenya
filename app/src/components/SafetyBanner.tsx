import type { SafetyTriageResult } from '../engine/safety'

interface SafetyBannerProps {
  result: SafetyTriageResult
  /** Extra context lines, e.g. which dates in a report window triggered this. */
  detailLines?: string[]
}

/**
 * Renders a non-diagnostic care-level notice. Deliberately not dismissible —
 * this reflects the current data, not a one-time alert; it disappears on its
 * own once the triggering answers are no longer current.
 */
export function SafetyBanner({ result, detailLines }: SafetyBannerProps) {
  if (result.urgency === 'none') return null

  return (
    <div className={`safety-banner safety-banner--${result.urgency}`} role="alert">
      <p className="safety-banner__headline">{result.headline}</p>
      <p className="safety-banner__action">{result.action}</p>
      {result.reasons.length > 0 && (
        <ul className="safety-banner__reasons">
          {result.reasons.map((r) => (
            <li key={r.id}>{r.detail}</li>
          ))}
        </ul>
      )}
      {detailLines && detailLines.length > 0 && (
        <p className="safety-banner__meta">{detailLines.join(' · ')}</p>
      )}
      <p className="safety-banner__caveat">{result.caveat}</p>
    </div>
  )
}
