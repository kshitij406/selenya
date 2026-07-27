import { describe, expect, it } from 'vitest'
import {
  bodyFor,
  confirmBodyFor,
  confirmSubjectFor,
  FORBIDDEN_TERMS,
  subjectFor,
} from './templates.js'

const APP = 'Lunara'
const UNSUB = 'https://lunara.app/v1/unsubscribe?id=x&t=y'
const CONFIRM = 'https://lunara.app/v1/confirm?id=x&t=y'

describe('reminder templates leak no health information', () => {
  const surfaces = [
    subjectFor(APP).toLowerCase(),
    bodyFor(APP, UNSUB).text.toLowerCase(),
    bodyFor(APP, UNSUB).html.toLowerCase(),
    confirmSubjectFor(APP).toLowerCase(),
    confirmBodyFor(APP, CONFIRM).text.toLowerCase(),
    confirmBodyFor(APP, CONFIRM).html.toLowerCase(),
  ]

  it.each(FORBIDDEN_TERMS)('contains no reference to "%s"', (term) => {
    for (const surface of surfaces) {
      expect(surface).not.toContain(term)
    }
  })

  it('still includes the app name and an unsubscribe link', () => {
    expect(subjectFor(APP)).toContain(APP)
    const body = bodyFor(APP, UNSUB)
    expect(body.text).toContain(UNSUB)
    expect(body.html).toContain(UNSUB)
  })

  it('confirmation email includes the app name and confirm link', () => {
    expect(confirmSubjectFor(APP)).toContain(APP)
    const body = confirmBodyFor(APP, CONFIRM)
    expect(body.text).toContain(CONFIRM)
    expect(body.html).toContain(CONFIRM)
  })
})
