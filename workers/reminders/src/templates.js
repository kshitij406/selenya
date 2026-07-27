/**
 * Reminder email templates. HARD RULE: these must never contain any health,
 * cycle, or symptom term — the whole privacy stance depends on the message
 * being content-free. The wording is generic on purpose; the app decides
 * locally what the reminder is about. Enforced by templates.test.js.
 */

export function subjectFor(appName) {
  return `A reminder from ${appName}`
}

export function bodyFor(appName, unsubUrl) {
  return {
    text: `You have a reminder waiting in ${appName}. Open the app to see it.\n\nTo stop these emails: ${unsubUrl}`,
    html: `<p>You have a reminder waiting in ${appName}. Open the app to see it.</p><p style="color:#8a7580;font-size:12px">To stop these emails, <a href="${unsubUrl}">unsubscribe</a>.</p>`,
  }
}

export function confirmSubjectFor(appName) {
  return `Confirm your ${appName} reminder`
}

/** Sent once, before any recurring reminder, so we never email an address that didn't ask for it. */
export function confirmBodyFor(appName, confirmUrl) {
  return {
    text: `Someone requested reminders from ${appName} for this email address. If that was you, confirm here: ${confirmUrl}\n\nIf you didn't request this, you can ignore this email — nothing else will happen unless you confirm.`,
    html: `<p>Someone requested reminders from ${appName} for this email address.</p><p>If that was you, <a href="${confirmUrl}">confirm your subscription</a>.</p><p style="color:#8a7580;font-size:12px">If you didn't request this, you can ignore this email — nothing else will happen unless you confirm.</p>`,
  }
}

/** Words that must never appear in any reminder — the test asserts this. */
export const FORBIDDEN_TERMS = [
  'period',
  'cycle',
  'ovulation',
  'ovulating',
  'fertile',
  'fertility',
  'pregnan',
  'menstrual',
  'menstruation',
  'symptom',
  'flow',
  'bleeding',
  'pill',
  'birth control',
  'bbt',
  'temperature',
  'perimenopause',
  'menopause',
  'discharge',
  'cramps',
  'due date',
]
