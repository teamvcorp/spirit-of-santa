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

## Env names we will use (Phase 5 slice 4) — set 2026-11-06

| Variable | Looks like | What it is |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | `AC` + 32 hex | Account SID (Console home). NOT the `SK…` key. |
| `TWILIO_API_KEY_SID` | `SK` + 32 hex | API key (Account → API keys & tokens → Create API key, Standard) |
| `TWILIO_API_KEY_SECRET` | 32 chars | That key's secret (shown once when created) |
| `TWILIO_MESSAGING_SERVICE_SID` | `MG` + 32 hex | Messaging Service (preferred: STOP/opt-out handling) |
| `TWILIO_PHONE_NUMBER` | `+1XXXXXXXXXX` | only if no Messaging Service |

The main Auth Token is NOT needed (an API key can be revoked on its own). Never paste values in chat.

## Test credentials

Console → Account (top right) → **API keys & tokens** → section **"Test credentials"**: a separate Test
Account SID + Test Auth Token. They never send a real text or charge, but only work with Twilio's "magic"
numbers (From `+15005550006`) and NOT with API keys or Messaging Services. We don't need them: in local
dev our SMS code prints the text to the server console instead of sending (same as email) unless
`TWILIO_DEV_SEND=true`. Real texts also need A2P 10DLC approval first.

## A2P 10DLC campaign answers (drafted 2026-11-06; submit only when these URLs are LIVE)

Before submitting: pay-later form live at spiritofsanta.com, /privacy has the SMS section ("mobile numbers
are not shared with third parties or affiliates for marketing"), /terms exists with SMS terms. Reviewers
open the links; an unreachable opt-in page is a common rejection reason.

**Opt-in type:** Web form (reached from a QR code).

**Describe opt-in / consent** (paste):

> Recipients are adult members of the public who received a good deed from a child in our program.
> They scan the deed's QR code, which opens a web page on https://spiritofsanta.com (example:
> https://spiritofsanta.com/d/<code>). On that page they may choose "Pay later by text", type their own
> mobile number, and tick an unchecked consent box that reads: "Text me a link to pay this tip later.
> Spirit O Santa will send 1 text message to this number with a secure payment link that expires in 7
> days. No marketing. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Privacy Policy:
> https://spiritofsanta.com/privacy Terms: https://spiritofsanta.com/terms". The form cannot be
> submitted without the box ticked. We record the time of consent with the number. We send exactly one
> transactional message per request (the payment link); no recurring or marketing messages. Numbers are
> never bought, rented or shared. Privacy Policy: https://spiritofsanta.com/privacy
> Terms of Service: https://spiritofsanta.com/terms

**Short version (706 characters, for the <1000 limit):**

> Adults who received a good deed from a child in our program scan the deed's QR code, which opens a web page on https://spiritofsanta.com. There they may choose "Pay later by text", enter their own mobile number and tick an unchecked box: "Text me a link to pay this tip later. Spirit O Santa will send 1 text with a secure payment link that expires in 7 days. No marketing. Msg & data rates may apply. Reply STOP to opt out, HELP for help." The form can't be sent without the box ticked; we record the consent time. We send one transactional message per request, never marketing, and never buy, rent or share numbers. Privacy Policy: https://spiritofsanta.com/privacy Terms: https://spiritofsanta.com/terms


**Gotcha (2026-11-06):** the description box rejects a link followed by punctuation ("https://spiritofsanta.com." with a
full stop) with "The url you entered is invalid". Never put a full stop or comma right after a link.

**Version A (728 chars, links at the end):**

> Adults who received a good deed from a child in our program scan the deed's QR code, which opens a page on our website spiritofsanta dot com. There they may choose "Pay later by text", enter their own mobile number and tick an unchecked box: "Text me a link to pay this tip later. Spirit O Santa will send 1 text with a secure payment link that expires in 7 days. No marketing. Msg & data rates may apply. Reply STOP to opt out, HELP for help." The form can't be sent without the box ticked; we record the consent time. We send one transactional message per request, never marketing, and never buy, rent or share numbers. Privacy Policy and Terms of Service: https://spiritofsanta.com/privacy and https://spiritofsanta.com/terms

**Version B (664 chars, no links: if the box also checks that links load, use this until the site is live):**

> Adults who received a good deed from a child in our program scan the deed's QR code, which opens a page on our website. There they may choose "Pay later by text", enter their own mobile number and tick an unchecked box: "Text me a link to pay this tip later. Spirit O Santa will send 1 text with a secure payment link that expires in 7 days. No marketing. Msg & data rates may apply. Reply STOP to opt out, HELP for help." The form can't be sent without the box ticked; we record the consent time. We send one transactional message per request, never marketing, and never buy, rent or share numbers. Our Privacy Policy and Terms of Service are linked on that page.

**Proof-of-consent box** ("For proof of consent by web form, provide a link…"): ONLY links, one per line,
each starting with https://. The form isn't published yet, so upload `docs/vendor/twilio-optin-form.png`
(screenshot of the planned "Pay later by text" form, made 2026-11-06) to Google Drive, share it as
"Anyone with the link", and paste that Drive link alone. **Slice 4 MUST build the real form to match this
screenshot and the wording above** (one text, 7-day link, STOP/HELP, privacy + terms links, unchecked box).

**SUBMITTED in the A2P form (2026-11-06) — these URLs are now commitments, keep them working:**
- Proof of consent (web form): https://spiritofsanta.com/text-messages (permanent public page with the same
  opt-in form + wording; Spanish /es/text-messages). Real per-deed form: /d/<code> (single-use).
- Privacy Policy: https://spiritofsanta.com/privacy (needs the SMS section: numbers not shared for marketing)
- Terms of Service: https://spiritofsanta.com/terms (to build, with SMS terms)

**Opt-in message (optional box), submitted 2026-11-06.** Our flow has NO separate confirmation text (we
registered exactly 1 text per request), so this is the one message itself:

> Spirit O Santa: here is your link to pay the tip for the good deed you received. It expires in 7 days: https://buy.stripe.com/abc123 Msg & data rates may apply. Reply STOP to opt out, HELP for help

(197 chars = 2 SMS segments. No child's name in texts. Link = a Stripe Payment Link on buy.stripe.com, never a
public URL shortener (carriers block those). Slice 4 must send exactly this wording, with the real link.)

## Where to find each value (Twilio Console, console.twilio.com) — 2026-11-06

1. `TWILIO_ACCOUNT_SID` (AC…): Console home → "Account Info" panel → Account SID.
2. `TWILIO_API_KEY_SID` (SK…) + `TWILIO_API_KEY_SECRET`: account/Admin menu (top right) → "API keys & tokens" →
   "Create API key" → name `spiritofsanta-family`, type **Standard** → copy the SID and the Secret (the secret is
   shown ONCE). If unsure which secret belongs to an existing key, make a new key and revoke the old one.
3. `TWILIO_MESSAGING_SERVICE_SID` (MG…): Messaging → Services → the service linked to the A2P campaign
   (create one, e.g. "Spirit O Santa pay-later", if needed) → Service SID. Add the phone number to its Sender Pool.
4. `TWILIO_PHONE_NUMBER` (+1…): Phone Numbers → Manage → Active numbers. Only needed without a Messaging Service.

Put them in `apps/family/.env.local` (local) and the Vercel **family** project (production). Remove the old
`TWILIO_AUTH_TOKEN` / `TWILIO_SID` lines once the API key works. Never paste values in chat or git.
