import { useEffect, useState } from 'react'
import { hashPin } from '../crypto/vault'
import { getSetting, removeSetting, setSetting, SK } from '../db/schema'
import {
  authenticateWithBiometrics,
  getBiometricStatus,
  type BiometricKind,
} from '../native/biometrics'
import { useApp } from '../state/appStore'

export function PinLock() {
  const setLocked = useApp((s) => s.setLocked)
  const [entered, setEntered] = useState('')
  const [shake, setShake] = useState(false)
  const [biometricKind, setBiometricKind] = useState<BiometricKind>('none')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [failCount, setFailCount] = useState(0)
  const [lockUntil, setLockUntil] = useState(0)
  const [, forceTick] = useState(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const enabled = (await getSetting(SK.biometricLock)) === '1'
      const [storedFailCount, storedLockUntil] = await Promise.all([
        getSetting(SK.pinFailCount),
        getSetting(SK.pinLockUntil),
      ])
      if (alive) {
        setFailCount(Number(storedFailCount) || 0)
        setLockUntil(Number(storedLockUntil) || 0)
      }
      if (!enabled) return
      const status = await getBiometricStatus()
      if (!alive || !status.available || !status.enrolled) return
      setBiometricKind(status.kind)
      await unlockWithBiometrics()
    })().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (lockUntil <= Date.now()) return
    const id = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [lockUntil])

  const remainingLockSeconds = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000))

  async function unlockWithBiometrics() {
    setAuthBusy(true)
    setAuthError(null)
    try {
      const result = await authenticateWithBiometrics()
      if (result.authenticated) {
        setLocked(false)
      } else if (result.errorCode && result.errorCode !== 'USER_CANCEL') {
        setAuthError('Biometric unlock was unavailable. Use your PIN.')
      }
    } catch {
      setAuthError('Biometric unlock was unavailable. Use your PIN.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function press(d: string) {
    if (Date.now() < lockUntil) {
      setShake(true)
      setTimeout(() => setShake(false), 350)
      return
    }
    const next = entered + d
    setEntered(next)
    if (next.length === 4) {
      const [salt, hash] = await Promise.all([getSetting(SK.pinSalt), getSetting(SK.pinHash)])
      if (salt && hash && (await hashPin(next, salt)) === hash) {
        setFailCount(0)
        setLockUntil(0)
        await Promise.all([removeSetting(SK.pinFailCount), removeSetting(SK.pinLockUntil)])
        setLocked(false)
      } else {
        const nextFailCount = failCount + 1
        setFailCount(nextFailCount)
        await setSetting(SK.pinFailCount, String(nextFailCount))
        if (nextFailCount >= 5) {
          const lockSeconds = Math.min(30 * 2 ** (nextFailCount - 5), 300)
          const until = Date.now() + lockSeconds * 1000
          setLockUntil(until)
          await setSetting(SK.pinLockUntil, String(until))
        }
        setShake(true)
        setTimeout(() => {
          setEntered('')
          setShake(false)
        }, 350)
      }
    }
  }

  return (
    <div className="overlay" style={{ zIndex: 60, justifyContent: 'center', gap: 28 }}>
      <h2 style={{ textAlign: 'center', fontSize: 22, fontWeight: 800 }}>Enter PIN</h2>
      <div className="pin-dots" style={shake ? { animation: 'fade-in 100ms 3 alternate' } : undefined}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`pin-dot${entered.length > i ? ' filled' : ''}`} />
        ))}
      </div>
      {biometricKind !== 'none' && (
        <button className="biometric-unlock" disabled={authBusy} onClick={unlockWithBiometrics}>
          <span aria-hidden="true">{biometricKind === 'face' ? '◎' : '◉'}</span>
          {authBusy
            ? 'Checking…'
            : biometricKind === 'face'
              ? 'Unlock with Face ID'
              : 'Unlock with biometrics'}
        </button>
      )}
      {authError && <p className="error-text" style={{ textAlign: 'center' }}>{authError}</p>}
      {remainingLockSeconds > 0 && (
        <p className="error-text" style={{ textAlign: 'center' }}>
          Too many attempts. Try again in {remainingLockSeconds}s.
        </p>
      )}
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              className="pin-key"
              onClick={() => (k === '⌫' ? setEntered(entered.slice(0, -1)) : press(k))}
            >
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
