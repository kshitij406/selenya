# Store listing copy (draft)

Draft copy for the Play Console store listing form. Edit freely: this is a
starting point, not final marketing copy. Screenshots and the feature
graphic still need to be produced separately (see `PLAY_STORE_CHECKLIST.md`).

## App name

Selenya

## Short description (≤80 chars, currently 79)

Private, local-first cycle tracking. Your data never leaves your device.

## Full description (≤4000 chars)

Selenya is a menstrual and reproductive health tracker built around one
rule: your health data belongs on your device, not on a server.

**Why that matters.** In 2021 the FTC found that a major period-tracking
app had shared users' sensitive health data with Facebook and Google
despite promising not to; in 2025 that same company and Google agreed to
pay $56 million to settle related lawsuits over it. That's not a
hypothetical risk. It's public record. Selenya sidesteps that failure mode
entirely: there's no Selenya-run server holding your health data, so
there's nothing on our end to leak.

**Everything stays local by default.** Cycle logs, symptoms, basal body
temperature, mood, sleep, and notes are encrypted on your device and never
uploaded anywhere. There's no account to create, no server-side database,
and nothing to breach.

**Track what matters to you.**
• Period, flow, and cycle predictions
• Basal body temperature and ovulation tests
• Symptoms, mood, and digestion
• Sleep, steps, and weight (with optional Health Connect import)
• Pregnancy and TTC (trying to conceive) tools
• Free-text notes for anything else

**Everything optional is opt-in, not on by default.**
• Encrypted cloud backup, zero-knowledge by design: your recovery code
  never leaves your device, so we can't read your backup even if we wanted to.
• Email reminders: generic, health-term-free notifications at times you
  choose, so a glance at your inbox reveals nothing.
• AI health assistant: bring your own API key (Anthropic, OpenAI, or
  OpenRouter). Your messages go straight from your device to the provider
  you chose, using your key. We never see them.

**No ads. No analytics. No tracking.** Selenya has no advertising SDKs, no
analytics or crash-reporting libraries, and no third party gets your data
as a byproduct of using the app.

**Open source.** Selenya's full source code is public and auditable. Find
the link on the in-app Settings screen. Every claim above can be verified
by reading the code, not just trusting the copy on this page.

Selenya is a companion for understanding your cycle, not a medical device
and not a substitute for a clinician. It is not affiliated with Flo Health
Inc. or any other period-tracking company.

## Sourcing note: why this over Flo (or another mainstream period app)?

The paragraph above is deliberately light on specifics for the store
listing itself. The claim is sourced to two FTC actions against Flo
Health, Inc.:

- [FTC: Flo Health settles allegations it misled consumers about
  disclosure of health data](https://www.ftc.gov/news-events/news/press-releases/2021/01/developer-popular-womens-fertility-tracking-app-settles-ftc-allegations-it-misled-consumers-about)
  (Jan 2021) and the [finalized order](https://www.ftc.gov/news-events/news/press-releases/2021/06/ftc-finalizes-order-flo-health-fertility-tracking-app-shared-sensitive-health-data-facebook-google)
  (Jun 2021): data shared 2016–2019 with Facebook, Google, AppsFlyer, and
  Flurry despite Flo's privacy promises.
- [Malwarebytes: Google and Flo to pay $56 million after misusing users'
  health data](https://www.malwarebytes.com/blog/news/2025/09/google-and-flo-to-pay-56-million-after-misusing-users-health-data)
  (Sep 2025): the related class-action settlement (Google $48M, Flo $8M).

**Before you paste the full description in as-is, make a judgment call:**
Google Play's metadata policy prohibits using a competitor's name to
"divert" search traffic, and repeatedly naming a specific competitor in
store copy carries some risk of a listing flag even when the underlying
claim is accurate and sourced (as here). The draft above never names Flo
directly in the marketing paragraph; it says "a major period-tracking app"
instead, specifically to stay on the safe side of that policy while still
making the point. If you'd rather name Flo explicitly, that's your call to
make (nominative fair use for factual comparison is generally legally
fine), but weigh it against the store-listing risk before publishing.

## Category

Health & Fitness

## Contact / support

Link to https://github.com/kshitij406/selenya/issues (or a support email,
if you'd rather not route support through GitHub).
