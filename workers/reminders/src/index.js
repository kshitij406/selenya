/**
 * Lunara reminder relay.
 *
 * Stores only { email, sendTime, unsubToken, confirmToken, confirmed } per
 * subscriber — never anything about the user's cycle. Every email is generic
 * ("you have a reminder"); the app decides locally what it means. Send times
 * are user-chosen fixed clock times, not cycle-timed, so timing leaks
 * nothing. One-click unsubscribe. New subscriptions start unconfirmed and
 * expire on their own unless the address holder clicks the confirm link, so
 * /v1/subscribe can't be used to spam an address that never opted in.
 *
 * TODO(hardening): /v1/confirm's only defense against confirmToken guessing
 * is the token's own entropy (a v4 UUID, ~122 bits) — there's no rate limit
 * on confirm attempts. That's an acceptable tradeoff for now (brute-forcing
 * a UUID is infeasible), but if abuse shows up here too, add a per-IP limit
 * on /v1/confirm the same way /v1/subscribe is limited below.
 */
import {
  bodyFor,
  confirmBodyFor,
  confirmSubjectFor,
  subjectFor,
} from './templates.js'

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(request.url)

    // One-click unsubscribe (GET so it works straight from an email link).
    if (url.pathname === '/v1/unsubscribe') {
      const id = url.searchParams.get('id')
      const token = url.searchParams.get('t')
      if (id) {
        const raw = await env.SUBS.get(id)
        if (raw && JSON.parse(raw).unsubToken === token) await env.SUBS.delete(id)
      }
      return new Response('You have been unsubscribed.', { status: 200 })
    }

    // Confirms a pending subscription (link sent by email) so we never send
    // recurring reminders to an address that didn't actually request them.
    if (url.pathname === '/v1/confirm' && request.method === 'GET') {
      const id = url.searchParams.get('id')
      const token = url.searchParams.get('t')
      if (id) {
        const raw = await env.SUBS.get(id)
        if (raw) {
          const sub = JSON.parse(raw)
          if (sub.confirmToken === token) {
            await env.SUBS.put(id, JSON.stringify({ ...sub, confirmed: true }))
            return new Response('Your subscription is confirmed. You can close this page.', {
              status: 200,
            })
          }
        }
      }
      return new Response('This confirmation link is invalid or has expired.', { status: 400 })
    }

    if (url.pathname === '/v1/subscribe' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
      const { email, sendTime } = await request.json().catch(() => ({}))
      if (!isEmail(email) || !isTime(sendTime)) return json({ error: 'bad_request' }, 400, cors)

      // Per-IP and per-email limits: this endpoint would otherwise let anyone
      // subscribe a victim's address to indefinite emails at our cost.
      const maxPerIp = Number(env.MAX_SUBSCRIBES_PER_IP_PER_HOUR ?? '5')
      if (await tooManyAttempts(env, `ip:${ip}`, maxPerIp, 3600)) {
        return json({ error: 'rate_limited' }, 429, cors)
      }
      const maxPerEmail = Number(env.MAX_SUBSCRIBES_PER_EMAIL_PER_DAY ?? '3')
      if (await tooManyAttempts(env, `email:${email.toLowerCase()}`, maxPerEmail, 86400)) {
        return json({ error: 'rate_limited' }, 429, cors)
      }

      const id = crypto.randomUUID()
      const unsubToken = crypto.randomUUID()
      const confirmToken = crypto.randomUUID()
      // Unconfirmed subscriptions expire on their own if the link is never clicked.
      const pendingTtlSeconds = 60 * 60 * 24 * 3
      const sub = { email, sendTime, unsubToken, confirmToken, confirmed: false }
      await env.SUBS.put(id, JSON.stringify(sub), { expirationTtl: pendingTtlSeconds })
      await sendConfirmEmail(env, id, sub)
      return json({ ok: true, id, unsubToken }, 200, cors)
    }

    if (url.pathname === '/v1/subscribe' && request.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (id) await env.SUBS.delete(id)
      return json({ ok: true }, 200, cors)
    }

    return json({ error: 'not_found' }, 404, cors)
  },

  // Hourly cron: email everyone whose chosen hour matches now (UTC).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env))
  },
}

async function sendDueReminders(env) {
  const hour = new Date().getUTCHours()
  let cursor
  do {
    const page = await env.SUBS.list({ cursor })
    cursor = page.list_complete ? undefined : page.cursor
    for (const key of page.keys) {
      const raw = await env.SUBS.get(key.name)
      if (!raw) continue
      const sub = JSON.parse(raw)
      if (!sub.confirmed) continue
      if (Number(sub.sendTime.split(':')[0]) !== hour) continue
      await sendEmail(env, key.name, sub)
    }
  } while (cursor)
}

async function sendEmail(env, id, sub) {
  const unsubUrl = `${originOf(env)}/v1/unsubscribe?id=${id}&t=${sub.unsubToken}`
  const body = bodyFor(env.APP_NAME, unsubUrl)
  await postEmail(env, {
    to: sub.email,
    subject: subjectFor(env.APP_NAME),
    text: body.text,
    html: body.html,
    headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
  })
}

// Sent once at signup, before any recurring reminder — see /v1/subscribe.
async function sendConfirmEmail(env, id, sub) {
  const confirmUrl = `${originOf(env)}/v1/confirm?id=${id}&t=${sub.confirmToken}`
  const body = confirmBodyFor(env.APP_NAME, confirmUrl)
  await postEmail(env, {
    to: sub.email,
    subject: confirmSubjectFor(env.APP_NAME),
    text: body.text,
    html: body.html,
  })
}

async function postEmail(env, { to, subject, text, html, headers }) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject,
      text,
      html,
      ...(headers ? { headers } : {}),
    }),
  }).catch(() => {})
}

// Fixed-window counter reused from the SUBS namespace (key-prefixed so it
// can't collide with subscription ids, which are UUIDs) — avoids needing a
// second KV binding just for rate limiting.
async function tooManyAttempts(env, key, max, windowSeconds) {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds)
  const rlKey = `ratelimit:${key}:${windowStart}`
  const count = Number((await env.SUBS.get(rlKey)) ?? '0')
  if (count >= max) return true
  await env.SUBS.put(rlKey, String(count + 1), { expirationTtl: windowSeconds + 60 })
  return false
}

function originOf(env) {
  return (env.ALLOWED_ORIGINS ?? 'https://lunara.app').split(',')[0].trim()
}
function isEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}
function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim())
  const allow = allowed.includes(origin) ? origin : allowed[0] ?? '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  }
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}
