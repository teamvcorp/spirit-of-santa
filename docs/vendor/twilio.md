# Twilio (pay-later SMS, Phase 5): what we'll need

> Saved 2026-11-05 (not integrated yet; no Twilio code exists). Verify against current Twilio docs
> when Phase 5 starts: console menus and compliance rules change.

## Credentials (put in `apps/family/.env.local` + Vercel **family** project, never in chat or git)

| Item | Where | Notes |
|---|---|---|
| Account SID (`AC…`) | Console home | Not secret alone |
| API Key SID + Secret (`SK…`) | Account → API keys & tokens → Create API key (Standard) | Prefer over the main Auth Token: revocable on its own. Secret shown once |
| Messaging Service SID (`MG…`) or a phone number | Messaging → Services / Phone Numbers | Service preferred: handles STOP/opt-out, number pool |

## Compliance (slow: start early)

- US carriers block unregistered business texting. Need **A2P 10DLC** (brand + campaign registration) for
  a local number, or **toll-free verification** for a toll-free number. Takes days to weeks.
- Campaign description: payment links sent at the request of a parent/donor (opt-in), 7-day expiry.

## Plan for our code (from the roadmap)

- Pay-later: SMS with a Stripe Payment Link; our code deactivates the link after 7 days (Payment Links
  don't expire on their own: see `stripe.md`).
- Env names (roadmap): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (→ we'll use API key vars instead),
  `TWILIO_PHONE_NUMBER` (→ or messaging service SID). Already listed in turbo.json build env.
