# Selenya

> This is a fork of [Blueturboguy07/lunara](https://github.com/Blueturboguy07/lunara),
> published under the same AGPL-3.0 license. See the commit history for the
> changes made here.

> **⚠️ Unfinished — this is a work in progress.**
> Selenya is not on the App Store or Google Play, and there is no installer to
> double-click. You build it from this repository and run it on your own phone.
> Features are landing continuously and things will break. Do not rely on it as
> your only record of your health data.

**An open-source, local-first cycle, fertility, pregnancy, and perimenopause companion.**

Selenya ships through native iOS and Android shells powered by Capacitor. Core
tracking works without an account or Selenya-hosted user database. Optional
backup and AI features transmit data only after you enable them; their scope and
security boundaries are documented in the repository.

Selenya is an open-source alternative to Flo®. It is not affiliated with, endorsed by, or connected to Flo Health Inc.

## Why

- **No subscription gate.** Tracking, pattern insights, reports, pregnancy
  guidance, and perimenopause tools are part of the open-source app.
- **Local first by architecture.** Core logs live in the app's local storage,
  encrypted at rest (see [Security](#security) below). Optional backup stores
  a client-encrypted blob; optional AI shares only the categories you select
  for that request.
- **No 54-screen onboarding funnel. No paywall gauntlet. No nagging.**

---

## Getting Selenya onto your phone

There is no download. You compile the app on a computer and install it on your
own phone over a cable. **What you need depends on the phone you have:**

| Your phone | Your computer | Works? | What you'll use |
| --- | --- | --- | --- |
| iPhone | Mac | ✅ | Xcode |
| Android | Mac | ✅ | Android Studio |
| Android | Windows | ✅ | Android Studio |
| iPhone | Windows | ❌ | Not possible — see below |

**iPhone + Windows is not possible.** Apple only allows iOS apps to be built and
signed on macOS with Xcode; there is no supported Windows path, and no amount of
setup works around it. Your options are to borrow a Mac, or run Selenya as a web
app in your phone's browser (`pnpm dev`, then open the printed network URL on
your phone) — the browser version keeps your data on the phone but has no
widgets, notifications, or Health integration.

### 1. Install the shared prerequisites

You need [Git](https://git-scm.com/downloads), [Node.js LTS](https://nodejs.org/en/download),
and pnpm. With Node installed:

```sh
npm install -g pnpm
```

### 2. Get the code and build the web bundle

```sh
git clone https://github.com/kshitij406/selenya.git
cd selenya
pnpm install
pnpm --filter @lunara/app native:sync
```

`native:sync` type-checks, builds the web bundle, and copies it into the native
iOS and Android projects. **Re-run it after every code change** — the native
shells load a copied bundle, not your live source.

### 3a. iPhone (requires a Mac)

1. Install **Xcode** from the Mac App Store, then open it once so it finishes
   installing its components.
2. Open the iOS project:
   ```sh
   pnpm --filter @lunara/app native:ios
   ```
3. In Xcode, select the **App** target → **Signing & Capabilities**. Under
   *Team*, pick your Apple ID. A **free** Apple ID works — you do not need the
   $99/year Developer Program. If you have never added your Apple ID, use
   *Add an Account…* in the Team dropdown.
4. If Xcode reports the bundle identifier is unavailable, change it to something
   unique to you (for example `app.selenya.mobile.yourname`).
5. Plug in your iPhone, unlock it, and tap **Trust** if asked. Select it from the
   device dropdown at the top of the Xcode window.
6. Press **▶ Run**.
7. The first launch will fail with *"Untrusted Developer."* On your iPhone go to
   **Settings → General → VPN & Device Management**, tap your Apple ID, and tap
   **Trust**. Then open Selenya again.

> With a free Apple ID the app stops working after **7 days**. Re-run step 6 to
> renew it. A paid Developer Program account extends this to a year.

### 3b. Android (Mac or Windows)

1. Install [**Android Studio**](https://developer.android.com/studio). On first
   launch let it install the default SDK and platform tools.
2. On your phone, enable developer mode: **Settings → About phone**, tap
   **Build number** seven times. Then in **Settings → System → Developer
   options**, turn on **USB debugging**.
3. Open the Android project:
   ```sh
   pnpm --filter @lunara/app native:android
   ```
4. Plug in your phone and tap **Allow** on the USB-debugging prompt.
5. Pick your phone from the device dropdown in Android Studio and press **▶ Run**.

### If something goes wrong

- **`pnpm: command not found`** — Node's global bin isn't on your PATH. Close and
  reopen your terminal, then try again.
- **`cap: command not found`** — you skipped `pnpm install`, or ran the command
  from the wrong folder. Run it from the repository root.
- **Xcode "No account for team"** — you haven't picked a Team under Signing &
  Capabilities (step 3a.3).
- **Android Studio doesn't see your phone** — the cable is charge-only, or USB
  debugging is off. Try a different cable first; it is usually the cable.
- **Your changes don't show up** — re-run `pnpm --filter @lunara/app native:sync`.

## Structure

- `app/` — React/Vite product layer plus Capacitor iOS and Android projects
- `workers/backup/` — stateless zero-knowledge backup relay (Cloudflare Worker + R2)
- `workers/reminders/` — opt-in generic email reminders (no health terms, ever)
- `docs/NATIVE_ARCHITECTURE.md` — current runtime and platform design
- `docs/FEATURE_PARITY.md` — honest implementation and release-readiness map

## Develop

```sh
pnpm install
pnpm dev      # run the app in a browser
pnpm test     # engine unit tests
pnpm --filter @lunara/app native:sync
```

The cycle engine is covered by a seeded fuzz audit
(`app/src/engine/estimateAudit.test.ts`) that exercises every user-facing
estimate across 360 generated histories. It must stay at zero violations —
run `pnpm test` before touching any prediction math.

## The AI companion is optional and bring-your-own-key

Selenya ships no shared API key and works fully without AI. If you enable it, you
supply your own credential:

- **Anthropic** — an API key, or a token from `claude setup-token` to bill
  answers to a Claude subscription instead of API credits.
- **OpenAI** — a project API key.
- **OpenRouter** — a project API key, restricted to OpenRouter's **free-tier
  models only** (the picker only offers `:free`-suffixed models, and the app
  refuses to call anything else, so this can never bill your OpenRouter
  account). If you want a personal build to skip pasting the key every time,
  copy `app/.env.example` to `app/.env.local` (gitignored — never committed)
  and set `VITE_OPENROUTER_DEFAULT_KEY`. Don't set that for a build you plan
  to hand to anyone else; the key would ship inside it.

Credentials are stored in the iOS Keychain / Android Keystore, never in the
cycle database and never in a backup. Nothing from your tracker is sent unless
you tick the specific categories for that message.

## Security

- **Encrypted at rest.** Every record — cycle logs, health profile, settings,
  bookmarks — is AES-256-GCM encrypted before it's written to the device's
  local database, and decrypted transparently when the app reads it. A raw
  database dump, device backup, or DevTools inspection sees ciphertext, not
  your health data.
- **Where the key lives.** On iOS/Android, the encryption key is generated
  once and stored in the Keychain/Keystore — the same hardware-backed secure
  storage used for your AI provider credentials, never in the database itself
  and never in a plain/encrypted export. Running Selenya as a browser tab
  (`pnpm dev`) has no equivalent OS-level keystore, so that mode keeps the key
  in the browser's local storage instead — real protection against a casual
  IndexedDB inspection, but not the hardware-backed guarantee native builds
  get; use a native build if that boundary matters to you.
- **PIN lock has brute-force backoff.** Repeated wrong PIN entries trigger an
  increasing lockout (30s after 5 failures, doubling up to 5 minutes).
- **Your data, your copy.** Settings → Export a backup file (plain) or Export
  encrypted (passphrase-protected) writes a portable JSON file; Import from
  file restores from either. Nothing about export/import requires an account
  or network connection.

## Disclaimer

Selenya is not a medical device and does not diagnose, treat, cure, or prevent any condition. Predictions are estimates for informational purposes only and must not be used to prevent pregnancy.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
