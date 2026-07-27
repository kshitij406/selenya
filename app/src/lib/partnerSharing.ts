import { decryptJSON, encryptJSON, partnerBlobIdFromCode, type Envelope } from '../crypto/vault'
import { applyImport, collectExport, type ExportPayload } from '../db/transfer'
import { providerFetch } from './providerFetch'

/**
 * Partner sharing, read-only full mirror: the sharer's device periodically
 * pushes an encrypted snapshot of everything it shows on Today/Calendar/
 * reports; the viewer's device pulls and decrypts it, then applies it into
 * its own local database so the existing screens render it unmodified (see
 * `state/partnerMode.ts` for the read-only gating that keeps a viewer device
 * from also writing). Same zero-knowledge relay as backup (`workers/backup/`),
 * different code and ID namespace (`partnerBlobIdFromCode`) so the two never
 * collide. The relay only ever sees ciphertext, same guarantee as backup.
 */

export async function pushPartnerSnapshot(endpoint: string, shareCode: string): Promise<void> {
  const [id, envelope] = await Promise.all([
    partnerBlobIdFromCode(shareCode),
    encryptJSON(await collectExport(), shareCode),
  ])
  const res = await providerFetch(`${endpoint.replace(/\/$/, '')}/v1/blob/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  if (!res.ok) throw new Error(`Partner sync failed (${res.status})`)
}

export async function pullPartnerSnapshot(endpoint: string, shareCode: string): Promise<number> {
  const id = await partnerBlobIdFromCode(shareCode)
  const res = await providerFetch(`${endpoint.replace(/\/$/, '')}/v1/blob/${id}`)
  if (res.status === 404) {
    throw new Error(
      'Nothing shared yet for that code. Ask your partner to open Settings → Partner sharing and sync at least once.',
    )
  }
  if (!res.ok) throw new Error(`Sync failed (${res.status})`)
  const envelope = (await res.json()) as Envelope
  const payload = await decryptJSON<ExportPayload>(envelope, shareCode).catch(() => {
    throw new Error('Could not decrypt — is the code correct?')
  })
  return applyImport(payload)
}

/** Best-effort — deletes the shared blob from the relay when sharing is turned off. */
export async function deletePartnerSnapshot(endpoint: string, shareCode: string): Promise<void> {
  const id = await partnerBlobIdFromCode(shareCode)
  await providerFetch(`${endpoint.replace(/\/$/, '')}/v1/blob/${id}`, { method: 'DELETE' }).catch(() => {})
}
