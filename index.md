# Selenya Privacy Policy

**Last updated:** 2026-07-27

Selenya is a local-first menstrual and reproductive health tracker. This
policy describes, plainly, what data the app touches and where it goes. If
anything here doesn't match the app's actual behavior, that's a bug in this
document. Please open an issue at
[github.com/kshitij406/selenya](https://github.com/kshitij406/selenya).

## The short version

- Your cycle, symptom, and health data is stored **only on your device**,
  encrypted at rest, and is never sent to us, because there is no "us"
  collecting it. There is no account, no server-side database, and no
  company behind Selenya that receives your data.
- Nothing leaves your device unless you explicitly turn on one of three
  opt-in features: encrypted cloud backup, email reminders, or the AI
  assistant. Each is described below with exactly what it sends and to whom.
- There are no ads, no analytics SDKs, no crash reporting, and no
  advertising or tracking identifiers anywhere in the app.

## Data stored on your device

Selenya stores the following in an encrypted local database
(AES-256-GCM; the encryption key lives in your device's Keychain/Keystore
on a real install, or `localStorage` in a browser/dev build):

- Daily logs: menstrual flow, basal body temperature, ovulation test
  results, symptoms, mood, sleep, weight, steps, and free-text notes you
  enter
- Cycle history, predictions, and settings derived from the above
- Content bookmarks and app preferences
- Your PIN (hashed with PBKDF2, not stored in plain text)

This data is not readable by anyone without your device and, on a native
install, your device's biometric/PIN unlock. We (the developer) have no
access to it, no copy of it, and no way to retrieve it if you lose your
device. See the Export and Backup sections below for how to protect
against that.

## Health Connect (Android)

If you grant permission, Selenya can read the following data types from
Android Health Connect: menstruation, basal body temperature, ovulation
test results, weight, sleep, and steps. This is used only to prefill your
local logs. Imported values are stored the same way as manually-entered
ones (encrypted, on-device), and none of it gets uploaded anywhere as a
result of this import. You can revoke Health Connect permission at any time in
Android system settings; Selenya will simply stop importing new data.

## Optional feature: encrypted cloud backup

Off by default. If you turn it on, Selenya encrypts your entire local
database on-device (AES-256-GCM, with a key derived via Argon2id from a
recovery code that is shown to you once and never transmitted) and uploads
only that opaque encrypted blob to a Cloudflare Worker we operate, which
stores it in Cloudflare R2 object storage.

- We never see your recovery code or encryption key, and therefore have no
  way to decrypt, read, or reconstruct your data from a backup.
- No account, email, or personal identifier is attached to a backup; it's
  addressed only by an ID derived from your recovery code.
- If you lose your recovery code, the backup is permanently unrecoverable,
  by you or by us.

## Optional feature: email reminders

Off by default. If you subscribe, Selenya sends your email address and your
chosen reminder times to a Cloudflare Worker we operate, which stores only
`{email, reminder times}` and nothing else. Reminder emails are sent via
Resend and are deliberately generic ("You have a reminder in Selenya").
They never mention cycle phase, symptoms, or any health term, so if your
email is ever seen by someone else, the subscription itself gives nothing
away. Reminder times are fixed clock times
you choose, not synced to your cycle, so delivery timing doesn't leak cycle
information either. You can unsubscribe with one click from any reminder
email, which deletes the stored row.

## Optional feature: AI assistant (bring-your-own-key)

Off by default, and requires you to supply your own API key for Anthropic,
OpenAI, or OpenRouter. When you use this feature:

- Your message and any tracker categories you explicitly approve **for
  that specific request** (via on-screen toggles) are sent directly from
  your device to the provider you chose, using your own API key. Nothing
  is sent unless you approve it for that request.
- There is no proxy server in between. The request goes from your device
  straight to Anthropic, OpenAI, or OpenRouter's API, subject to that
  provider's own privacy policy and terms.
- Your API key is stored only in your device's secure vault
  (Keychain/Keystore), never in the app's database, and never sent
  anywhere except as an authorization header to the provider you chose.
- If you use OpenRouter, Selenya restricts requests to free-tier models
  only, enforced both in the UI and as a hard runtime check.

Because this is a bring-your-own-key integration, we recommend reading the
privacy policy of whichever provider (Anthropic, OpenAI, or OpenRouter) you
choose to use, since your prompts are subject to their data handling, not
ours.

## Export and deletion

Settings → Export/Import lets you export a full, human-readable copy of
your data at any time, and re-import it (e.g., onto a new device). Deleting
the app, or clearing its data in system settings, permanently deletes
everything stored on-device. There is no server-side copy to separately
delete, aside from an opted-in cloud backup, and that's addressed only by
your recovery code, which only you hold, so it's yours to abandon simply by
not using that code again.

## What we don't do

- No advertising, no ad SDKs, no ad identifiers
- No analytics, telemetry, or crash-reporting SDKs
- No selling, renting, or sharing of your data with third parties for
  marketing purposes. There's nothing to sell in the first place, since we
  never receive it
- No account system, so no account to be breached

## Children's privacy

Selenya is not directed at children and is not intended for users who have
not reached the age at which menstrual tracking is relevant to them.

## Open source

Selenya's full source code, including every claim made in this policy, is
publicly auditable at
[github.com/kshitij406/selenya](https://github.com/kshitij406/selenya). It
is a fork of [Blueturboguy07/lunara](https://github.com/Blueturboguy07/lunara),
licensed under AGPL-3.0.

## Changes to this policy

If this policy changes, the "Last updated" date above will change and the
revision history is visible in the linked GitHub repository's commit log.

## Contact

Questions or concerns: open an issue at
[github.com/kshitij406/selenya/issues](https://github.com/kshitij406/selenya/issues).
