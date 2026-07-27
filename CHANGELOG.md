# Changelog

All notable changes to this fork, relative to
[Blueturboguy07/lunara](https://github.com/Blueturboguy07/lunara), are logged
here. Dates are UTC.

## Unreleased

### Fixed

- **Weak PIN hashing.** `hashPin` derived the app-lock PIN hash with a single
  unsalted-iteration SHA-256 round while the export/backup path used
  600k-round PBKDF2 for the same kind of secret. A leaked `pinHash`/`pinSalt`
  pair was brute-forceable near-instantly. Now derived with 200k-round
  PBKDF2-SHA256, matching the export path's approach.
  (`app/src/crypto/vault.ts`)
- **Locale-dependent report dates.** The doctor-report date range
  (`describeRange`) formatted with the host device's default locale
  (`toLocaleDateString(undefined, …)`), so the same report rendered
  differently per device/OS-language setting, and the fixture test failed
  outside en-US locales. Pinned to `'en-US'` so the format is stable and the
  test is deterministic everywhere. (`app/src/lib/dateRange.ts`)
- **Modulo bias in recovery-code generation.** `generateRecoveryCode` mapped
  random bytes into a 31-character alphabet via `byte % 31`; since
  `256 % 31 != 0`, some characters were slightly more likely than others.
  Fixed with rejection sampling. (`app/src/crypto/vault.ts`)
- **707 KB single JS bundle.** `Onboarding.tsx` statically imported
  model-picker constants from `lib/assistant.ts`, which also imports the
  Anthropic SDK — so the SDK loaded on every app launch even though
  onboarding never sends a request. Split the SDK-free constants into
  `lib/assistantModels.ts` and made `AssistantScreen` a `React.lazy`
  boundary. Main chunk: 707 KB → 524 KB; the AI SDK weight (~184 KB) now
  loads only when the assistant screen opens.
  (`app/src/App.tsx`, `app/src/lib/assistant.ts`, `app/src/lib/assistantModels.ts`,
  `app/src/screens/Onboarding.tsx`)

- **PIN brute-force had no throttling.** The 4-digit unlock PIN (10,000
  possible values) had no attempt limiting — a scripted or automated input
  source could try the full keyspace with no delay. Added a persisted fail
  counter with exponential backoff (5 failures → 30s lockout, doubling to a
  5-minute cap), reset on a correct entry.
  (`app/src/components/PinLock.tsx`, `app/src/db/schema.ts`)
- **Backup/restore likely didn't work at all on-device.** `lib/backup.ts` used
  raw `fetch`, but the backup Worker's CORS allowlist doesn't include a
  Capacitor WebView's origin — every other provider call in the app already
  routes through `providerFetch` (native `CapacitorHttp` on iOS/Android)
  specifically to avoid this. Fixed to match. (`app/src/lib/backup.ts`)
- **`dangerouslySetInnerHTML` used for a static string.** `Settings.tsx`'s
  `Section` title rendered via `dangerouslySetInnerHTML` just to get an
  `&amp;` entity to display — harmless with today's hardcoded strings, but an
  XSS footgun for any future caller passing a dynamic string. Replaced with
  plain JSX text. (`app/src/screens/Settings.tsx`)
- **Imported backup data was trusted without validation.** `applyImport` only
  checked `payload.app`/`payload.v` before bulk-writing `dailyLogs`,
  `settings`, and `contentBookmarks` arrays into Dexie. A malformed or
  hand-edited import file could corrupt records that downstream prediction/
  export code assumes are well-formed. Added per-row type guards that drop
  and log malformed rows individually instead of trusting the whole array.
  (`app/src/db/transfer.ts`, new `app/src/db/transfer.test.ts`)
- **Two Cloudflare Workers accepted unauthenticated writes with no rate
  limit.** `workers/backup`'s `PUT /v1/blob/:id` only validated the id's hex
  format (not that it was legitimately derived from a real recovery code —
  the zero-knowledge design has no way to check that server-side), so
  anyone could script writes to fill the R2 bucket. `workers/reminders`'
  `POST /v1/subscribe` accepted any `{email, sendTime}` with no ownership
  proof, so anyone could subscribe a victim's email to indefinite reminders
  and drain the Resend sending quota. Added per-IP (and per-email, for
  reminders) rate limiting via a KV-backed counter to both, and added email
  confirmation (a verify link before a subscription becomes active) to the
  reminders worker.
  (`workers/backup/src/index.js`, `workers/backup/wrangler.toml`,
  `workers/reminders/src/index.js`, `workers/reminders/src/templates.js`,
  `workers/reminders/wrangler.toml`) — **deploy note:** the backup worker
  needs a new KV namespace provisioned (`wrangler kv namespace create
  RATE_LIMITS`, then paste the id into `workers/backup/wrangler.toml`)
  before this is deployed; reminders reuses its existing `SUBS` namespace.

### Added

- **Encrypted local database.** Every record written to IndexedDB (cycle
  logs, health profile, settings, bookmarks) is now AES-256-GCM encrypted
  before it hits disk, and decrypted transparently on read — a raw database
  dump, WebView cache inspection, or casual DevTools poke through
  Application → IndexedDB now yields ciphertext, not plaintext health data.
  The key is generated once and stored in the native Keychain/Keystore via
  the existing secure-vault bridge on iOS/Android (a real hardware security
  boundary); browser/dev mode (no OS keystore) falls back to `localStorage`
  rather than pure in-memory, specifically because in-memory-only would
  regenerate a new key — and silently orphan all existing data — on every
  page reload, which is worse than the honest boundary of a same-origin-
  readable key for a mode that's explicitly documented as a dev/preview path.
  Implemented as a Dexie DBCore middleware (`db.use(...)`), transparent to
  every existing `.get()`/`.put()`/`.bulkPut()`/`.delete()`/`.toArray()` call
  site in the app — nothing outside `db/schema.ts` had to change except two
  call sites that used Dexie's cursor-based `.filter()` API (which encrypted
  tables intentionally don't support, since it can't be decrypted
  transparently without reimplementing IndexedDB's cursor protocol); both
  were rewritten to plain `.toArray()` + an in-memory `Array.filter()`,
  which was already how every other read in the app worked.
  Verified against a **real** (fake-indexeddb-backed, not mocked) IndexedDB:
  round-trip correctness, zero plaintext health fields in the raw stored
  row, the multi-step explicit-transaction path (`ensureHealthProfile`/
  `putHealthProfile`), and that a cursor query fails loudly instead of
  silently returning encrypted garbage. This test suite caught and led to
  fixing a real bug during development: `crypto.subtle.encrypt`/`decrypt`
  are genuinely async and let Dexie's IndexedDB transaction auto-commit
  before the operation completed, which would have broken every database
  write in production; fixed with `Dexie.waitFor()`, the documented pattern
  for exactly this.
  (new `app/src/db/encryption.ts`, `app/src/db/encryption.test.ts`,
  `app/src/db/schema.ts`, `app/src/components/CalendarScreen.tsx`,
  `app/src/native/secureVault.ts`)
- **OpenRouter as a third AI provider, free-tier only.** Same bring-your-own-
  key pattern as Anthropic/OpenAI — pasted in AI settings, stored in the
  native secure vault, never written to the cycle database or a backup.
  Restricted to OpenRouter's zero-cost tier by policy: the model picker only
  offers `:free`-suffixed models, and the request path hard-rejects any
  non-`:free` model before sending, so this can never bill an OpenRouter
  account regardless of how config is constructed. A gitignored
  `.env.local` (see `app/.env.example`) can optionally prefill — never
  auto-save — a personal convenience key for your own builds; it's never
  committed to git history, and a public build without a personal
  `.env.local` shows an empty field like any other provider.
  (`app/src/lib/assistant.ts`, `app/src/lib/assistantModels.ts`,
  `app/src/components/AssistantScreen.tsx`, `app/src/native/secureVault.ts`,
  `app/.env.example`, `app/src/vite-env.d.ts`)

### Docs

- Added an upstream-fork attribution note to `README.md`.

---

Verification for every entry above: `pnpm --filter @lunara/app test` (185/185
passing, including real-IndexedDB integration tests) and
`pnpm --filter @lunara/app build` (clean).
