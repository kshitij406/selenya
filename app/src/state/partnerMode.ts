import { useLiveQuery } from 'dexie-react-hooks'
import { getSetting, SK } from '../db/schema'

export interface PartnerModeState {
  /** True on a device that pulled someone else's shared data — gates every local write path. */
  active: boolean
  label: string
}

const DEFAULT_STATE: PartnerModeState = { active: false, label: '' }

/**
 * Read-only mirror gate. `LogSheet` is the single write path for daily data
 * regardless of which screen opened it, so gating there covers every entry
 * point without needing to disable buttons individually on Today, Calendar,
 * and DateStrip. Lower-traffic write surfaces (contraception regimen entry,
 * pregnancy checklist) are not gated — see handoff.md for that scope call.
 */
export function usePartnerMode(): PartnerModeState {
  const state = useLiveQuery(async () => {
    const [mode, label] = await Promise.all([
      getSetting(SK.partnerViewerMode),
      getSetting(SK.partnerViewerLabel),
    ])
    if (mode !== 'true') return DEFAULT_STATE
    return { active: true, label: label?.trim() || "your partner's" }
  }, [])
  return state ?? DEFAULT_STATE
}
