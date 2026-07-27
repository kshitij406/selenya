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

### Docs

- Added an upstream-fork attribution note to `README.md`.

---

Verification for every entry above: `pnpm --filter @lunara/app test` (173/173
passing) and `pnpm --filter @lunara/app build` (clean).
