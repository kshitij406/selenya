import { describe, expect, it } from 'vitest'
import { blobIdFromCode, decryptJSON, encryptJSON, partnerBlobIdFromCode } from './vault'

describe('partnerBlobIdFromCode', () => {
  it('is deterministic for the same code', async () => {
    const id1 = await partnerBlobIdFromCode('ABCD-EFGH-1234')
    const id2 = await partnerBlobIdFromCode('ABCD-EFGH-1234')
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^[a-f0-9]{40}$/)
  })

  it('is insensitive to case and formatting, like blobIdFromCode', async () => {
    const a = await partnerBlobIdFromCode('abcd-efgh-1234')
    const b = await partnerBlobIdFromCode('ABCD EFGH 1234')
    expect(a).toBe(b)
  })

  it('never collides with a backup blob id for the same literal code', async () => {
    const code = 'SAME-CODE-0000'
    const backupId = await blobIdFromCode(code)
    const partnerId = await partnerBlobIdFromCode(code)
    expect(partnerId).not.toBe(backupId)
  })
})

describe('encryptJSON / decryptJSON round trip with a partner-sharing code', () => {
  it('decrypts back to the original payload with the same code', async () => {
    const payload = { app: 'lunara', v: 1, dailyLogs: [{ date: '2026-07-01', flow: 'medium' }] }
    const envelope = await encryptJSON(payload, 'PART-NER1-CODE')
    const decrypted = await decryptJSON<typeof payload>(envelope, 'PART-NER1-CODE')
    expect(decrypted).toEqual(payload)
  })

  it('fails to decrypt with the wrong code', async () => {
    const envelope = await encryptJSON({ secret: true }, 'RIGHT-CODE-1')
    await expect(decryptJSON(envelope, 'WRONG-CODE-1')).rejects.toThrow()
  })
})
