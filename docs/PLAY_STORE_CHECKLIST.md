# Play Store submission checklist

Everything engineering-side is done (see "Done this pass" below). What's
left requires a human with a Google account, a credit card, and legal
judgment — none of which an agent can supply. This is that list, in order.

**Update (session 3, 2026-07-27):** safety-triage routing, contraception
regimen history, health-import provenance/conflict UI, native iOS PDF
share, and a new **partner sharing** feature (read-only, opt-in, off by
default) were added — see `handoff.md` for details.
`PLAY_CONSOLE_SUBMISSION_DATA.md`'s Data Safety table now includes partner
sharing. **Native SQLite (the P0 encrypted-database item further down this
doc's history) was deliberately deferred** — see `sql_plan.md` for why and
the plan for doing it as a fast-follow; the current app is not shipping
with an encryption regression, it's shipping with the same AES-256-GCM
app-level encryption it already had.

## Done this pass (engineering side)

- Release signing: `app/android/keystores/selenya-release.keystore` +
  `app/android/key.properties` (both gitignored — **back these up somewhere
  durable outside this machine right now**, e.g. a password manager or
  encrypted cloud storage. If this keystore is lost, this app can never be
  updated on Play again under the same listing — Google cannot reissue it).
  `bundleRelease` produces a correctly-signed AAB, verified with `jarsigner`.
- Splash screens (11 Android + 3 iOS) regenerated to match the Phase Ring
  icon on `#FFFDF9`, `capacitor.config.ts` background colors reconciled.
- `PRIVACY_POLICY.md` — accurate description of local storage, Health
  Connect import, and the three opt-in network features (backup, reminders,
  BYOK AI assistant).
- `docs/PLAY_CONSOLE_SUBMISSION_DATA.md` — pre-filled answers for the Data
  Safety form and Health Connect permissions declaration.
- AGPL-3.0: LICENSE present, README attributes upstream, in-app Settings
  footer now links to the source repo.
- Full test suite (184/184), typecheck, and web build all green. Signed
  release AAB builds cleanly.

## Steps only you can do

1. **Back up the keystore.** Seriously, do this before anything else below.
   `app/android/keystores/selenya-release.keystore` and
   `app/android/key.properties`.

2. **Host the privacy policy at a public URL.** `PRIVACY_POLICY.md` needs
   to be reachable by URL, not just committed to the repo. Easiest options:
   - GitHub renders markdown at
     `https://github.com/kshitij406/selenya/blob/main/PRIVACY_POLICY.md` —
     Play Console accepts this in practice.
   - Cleaner: enable GitHub Pages for the repo, or add a static route on
     the `lunara.app` domain you already control (the `workers/` Cloudflare
     Workers are on that domain).

3. **Create a Google Play Console developer account** — one-time $25 fee,
   requires identity verification (can take a few days). Do this early;
   it's the long pole.

4. **Create the app listing** in Play Console: app name (Selenya), default
   language, app/game category (Health & Fitness), free/paid.

5. **Store listing assets**:
   - Short description and full description — drafted in
     `docs/STORE_LISTING_COPY.md`, ready to paste in (edit to taste first)
   - Feature graphic (1024×500) — not produced by this pass, needs actual
     design work
   - At least 2 phone screenshots (recommend 4-8, showing Today, log
     sheet, reports, settings)
   - App icon is already done (Phase Ring, `ic_launcher.png` set)

6. **Content rating questionnaire** — answer Google's standard IARC
   questionnaire. Expect this to land in the "Health" or similar category
   given menstrual/reproductive health content; answer honestly about the
   AI assistant (user-generated/interactive content) and lack of ads.

7. **Data Safety form** — fill in using `docs/PLAY_CONSOLE_SUBMISSION_DATA.md`.

8. **Health Connect permissions declaration** — submit the justification
   table from `docs/PLAY_CONSOLE_SUBMISSION_DATA.md` through Play Console's
   Health Connect / sensitive-permissions review flow. This is a separate
   Google review step that can take longer than standard app review — start
   it early, ideally before the rest of the listing is finalized.

9. **Target audience & content** — declare this is not directed at
   children (per `PRIVACY_POLICY.md`'s children's-privacy section).

10. **Upload the signed AAB**:
    `app/android/app/build/outputs/bundle/release/app-release.aab`
    (rebuild first with `cd app/android && JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" GRADLE_USER_HOME=.gradle ./gradlew bundleRelease`
    if any code has changed since this pass).

11. **Enroll in Play App Signing** when prompted during upload (Google's
    recommended default — Google re-signs your app for distribution while
    you keep your upload key). If Health Connect / App Links verification
    needs your certificate's SHA-256 fingerprint (see
    `workers/oauth-callback/README.md`'s `ANDROID_SHA256_CERT_FINGERPRINTS`
    note), get it from Play App Signing's dashboard after enrollment, not
    from the local upload keystore.

12. **Submit for review.** First review is typically the slowest; expect
    several days, possibly longer given the Health Connect declaration.

## Not required for submission, but worth knowing

- `engine/safety.ts` (safety-triage engine) is built and tested but not
  wired into any screen — not a submission blocker, but worth a follow-up
  pass since it's directly relevant to a health app's duty of care.
- No clinical/editorial review of in-app health content has been done —
  also not a Play Store technical requirement, but worth doing given the
  subject matter.
- iOS is not covered by this checklist — it needs a Mac to build, and
  App Store submission has its own separate process.
