# Play Console submission data

Reference material for filling in the two Play Console forms that ask
questions about data handling. This doc doesn't submit anything — it's the
answer key so the human filling in the actual web forms doesn't have to
re-derive this from source. Verified against `PRIVACY_POLICY.md` and the
actual code paths (`app/src/lib/assistant.ts`, `workers/*/README.md`,
`app/android/app/src/main/AndroidManifest.xml`).

## Data Safety form

**Does your app collect or share any of the required user data types?**
Yes — see below. Everything is collected, none is *shared* with third
parties in Google's sense, except the BYOK AI providers, which the user
explicitly invokes with their own key (see "Data sharing" note).

| Data type | Collected? | Shared? | Purpose | Optional? | Notes |
|---|---|---|---|---|---|
| Health info (menstrual, reproductive) | Yes | No | App functionality | No (core feature) | Encrypted on-device only |
| Health info (fitness — sleep, steps, weight) | Yes | No | App functionality | Yes (Health Connect import) | Only if user grants Health Connect permission |
| Email address | Yes | No | App functionality | Yes | Only if user opts into email reminders |
| App activity / in-app messages (AI chat text) | Yes | Yes* | App functionality | Yes | *Sent to the AI provider the user chose, using the user's own API key — not our infrastructure |
| User-generated content (notes) | Yes | No | App functionality | Yes | Free-text fields in daily logs |

**Is all user data encrypted in transit?** Yes — all network calls (backup,
reminders, AI providers, OAuth callback) are HTTPS only;
`usesCleartextTraffic="false"` is set in the manifest and enforced by
`network_security_config`.

**Do you provide a way for users to request data deletion?** Yes —
uninstalling the app deletes all local data (no server copy exists except
an opted-in backup, which is deleted by simply not using its recovery
code again; there's no account to submit a deletion request against).

**Data collection is required or optional:** All of it is optional except
what's needed for the core on-device tracking feature itself (which never
leaves the device). Backup, reminders, Health Connect import, and the AI
assistant are all off by default and require explicit user opt-in.

**Privacy policy URL:** point this at the hosted `PRIVACY_POLICY.md` (see
`docs/PLAY_STORE_CHECKLIST.md` for hosting options).

## Health Connect permissions declaration

Play Console requires justifying each `android.permission.health.*`
permission before Health Connect access is approved. Current manifest
requests (`app/android/app/src/main/AndroidManifest.xml`):

| Permission | Justification for the form |
|---|---|
| `READ_MENSTRUATION` | Core feature — imports existing menstrual flow logs from Health Connect so users don't have to re-enter cycle history already tracked elsewhere. |
| `READ_BASAL_BODY_TEMPERATURE` | Imports BBT readings used for the app's fertility-window and ovulation estimates, the same way manually-entered BBT is used. |
| `READ_OVULATION_TEST` | Imports OPK (ovulation predictor kit) results to corroborate cycle/fertility predictions alongside manually-entered results. |
| `READ_WEIGHT` | Optional wellness tracking alongside cycle data; displayed in the same log/report views as manually-entered weight. |
| `READ_SLEEP` | Optional wellness correlation (sleep vs. cycle phase/symptoms), displayed alongside manually-entered sleep data. |
| `READ_STEPS` | Optional wellness correlation (activity vs. cycle phase/symptoms), displayed alongside manually-entered step data. |

**Minimum data access:** all six are `read`-only (no `write`/`READ_WRITE`
requested). The app does not write back to Health Connect. Each permission
maps to a specific, visible feature (import into the matching log field) —
none are requested speculatively.

**Prominent disclosure requirement:** Google requires an in-app runtime
explanation before the OS permission prompt, and a way to view the
rationale later. The manifest already declares the two required intent
filters for this (`ACTION_SHOW_PERMISSIONS_RATIONALE` and
`VIEW_PERMISSION_USAGE` / `HEALTH_PERMISSIONS` category) — confirm the
actual in-app rationale screen these route to still reads clearly before
submitting (open the Health Connect import flow in Settings and check).

**What this doc does not cover:** the actual Play Console "Health Connect
permissions declaration" form and "minimum data access" review are
Google-side approval steps that require submitting this justification
through the Play Console UI itself — see `docs/PLAY_STORE_CHECKLIST.md`.
