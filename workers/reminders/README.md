# Lunara email reminders (M3)

Opt-in, hardened: stores only `{email, sendTimes[]}`. Every message is generic
— "You have a reminder in Lunara" — with **no health terms, ever** (enforced by
a test over templates). Send times are fixed user-chosen clock times, never
cycle-timed, so timing correlates with nothing. One-click unsubscribe deletes
the row. Cloudflare Worker cron + Resend.

New subscriptions are unconfirmed until the address holder clicks the link in
a one-time confirmation email (`GET /v1/confirm`); the hourly cron only sends
to confirmed subscribers, and unconfirmed rows expire on their own. `POST
/v1/subscribe` is also rate-limited per-IP and per-email (KV counters in the
existing `SUBS` namespace) so the endpoint can't be used to spam an address
or run up the Resend bill.
