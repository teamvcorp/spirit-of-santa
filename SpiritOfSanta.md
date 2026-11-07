# Spirit O Santa — Project Roadmap

Nov 4, 2026 · @Robert

## Project Overview

Spirit O Santa is a community-service incentive platform where children earn Christmas Magic points by performing good deeds, then spend those points building a funded Christmas wish list. Three separate Next.js web apps — family, store, and admin — share one MongoDB database on Vercel. Target launch: October 1, 2027 (live Christmas season).

**Apps**

| App | URL | Users |
| --- | --- | --- |
| Family | spiritofsanta.com | Children, Parents, Community Members |
| Store | store.spiritofsanta.com | Store Owners, Store Reps |
| Admin | admin.spiritofsanta.com | Spirit O Santa team |

**Key mechanic:** $1.50 in tips = 1 magic point. Kids add items to their Christmas list (point cost = item price); points are escrowed on add. Once an item is fully funded and has been on the list 30+ days, it locks and ships to Spirit O Santa for delivery by December 25.

## Tech Stack & Architecture

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js (App Router) | One repo per app; shared types package |
| Database | MongoDB via Mongoose | Single cluster, three apps share one DB |
| Hosting | Vercel | One Vercel project per app |
| Auth | NextAuth.js | Role-aware sessions; parent PIN stored separately |
| Payments | Stripe (embedded) | No redirects; Stripe Elements + webhooks |
| Push notifications | Firebase Cloud Messaging (FCM) | Web Push via service worker |
| Image storage | Vercel Blob (public store) | Store item photos only; re-encoded to WebP, EXIF stripped (`@repo/storage`). Decided 2026-11-05 |
| i18n | next-i18next | English + Spanish at launch |
| Home-screen icon | Next.js icon + manifest conventions | Icon/shortcut that opens the website (`display: "browser"`). No installable app/offline mode. Decided 2026-11-05 |
| SMS (pay-later) | Twilio | 7-day expiring payment links via text |

**Monorepo structure (recommended)**

```
spirit-o-santa/
├── apps/
│   ├── family/          # spiritofsanta.com
│   ├── store/           # store.spiritofsanta.com
│   └── admin/           # admin.spiritofsanta.com
├── packages/
│   ├── db/              # Mongoose models & shared schema
│   ├── ui/              # Shared React components
│   └── types/           # TypeScript interfaces
└── CLAUDE.md            # Claude Code context file
```

## Phase 1 — Foundation

**Nov 2026 — target complete by Nov 30**

Everything that all three apps share. No user-facing features yet — just the infrastructure every phase builds on.

- [ ] Initialize monorepo (Turborepo or npm workspaces), scaffold three Next.js apps
- [ ] Configure Vercel: one project per app, environment variables, preview deployments
- [ ] Stand up MongoDB Atlas cluster; connect via shared `packages/db` Mongoose models
- [ ] Design and implement full MongoDB schema (Users, Kids, Families, Stores, Items, Deeds, Transactions, Seasons)
- [ ] Implement NextAuth.js with role-based sessions (child, parent, store-owner, store-rep, admin, community)
- [ ] Parent PIN system (hashed, separate from main auth session)
- [x] Stripe account setup: webhook endpoint + handler (`packages/payments`), test mode keys in the family app (no Connect: stores are paid by check/outside the app, decided 2026-11-04; no refunds, decided 2026-11-05)
- [ ] FCM project setup; service worker scaffolding in all three apps
- [x] Vercel Blob (public) store; shared upload helper in `packages/storage` (replaces Cloudinary, 2026-11-05)
- [ ] Twilio account for SMS (pay-later links)
- [ ] next-i18next wired up; English and Spanish locale files stubbed out
- [x] Home-screen icon + manifest per app (placeholder star art until a real logo; no PWA, 2026-11-05)
- [ ] Shared component library baseline: buttons, forms, navigation, QR code renderer
- [ ] CLAUDE.md in repo root with project context for Claude Code sessions
- [ ] Domain configuration: spiritofsanta.com, store.spiritofsanta.com, admin.spiritofsanta.com

## Phase 2 — Store App MVP

**Dec 2026 – Jan 2027 — ⚠️ HARD DEADLINE: live by Jan 1, 2027**

Stores must be able to register and set their item lists during the Q1 window (Jan–Mar 2027). This is the most time-critical phase.

- [ ] Store self-registration form (name, contact, category, description, photos)
- [ ] Admin approval queue: admin reviews and approves/rejects store applications
- [ ] Store owner dashboard: profile management, rep enrollment/unenrollment, item pricing
- [ ] Store rep dashboard: add/edit items, adjust inventory counts, mark items as processed/shipped
- [ ] Item catalog: photo upload (Vercel Blob), name, description, price (retail), 50-item max enforced
- [ ] Season lock logic: item lists editable Jan 1–Mar 31 only; locked April 1 via date-gated UI + API validation
- [ ] Engagement matrix: impressions, wish-list adds, funding progress per item
- [ ] Store discount agreement: on signup, stores acknowledge discount + guarantee requirements
- [ ] Admin can invite stores directly (bypass self-signup)
- [ ] Basic Spanish localization for store-facing strings

## Phase 3 — Admin App Core

**Jan – Feb 2027**

Built alongside Phase 2 since admin approves stores. Gives your team operational control over the platform.

- [ ] Admin login (separate auth, MFA recommended)
- [ ] User management: view, approve, suspend any user type
- [ ] Store approval queue (feeds from Phase 2 store registrations)
- [ ] Deed catalog management: add/edit/remove preset deeds, set recommended tip range per deed type
- [ ] Season calendar controls: open/close season, trigger Q1 window open/close, force Dec 1 freeze
- [ ] Content moderation queue: flag and review submitted deed descriptions and store item text
- [ ] Corporate donation page management: configure zip-code targeting, generate tax receipt templates
- [ ] Platform analytics dashboard: total magic points in circulation, deeds completed, items funded, revenue
- [ ] Announcement system: push a notice to all app users
- [ ] Pay-later link management: view expired/pending links, resend or cancel

## Phase 4 — Family App Core

**Feb – Apr 2027**

The heart of the platform. Parents register, kids earn, the community tips.

**Registration & profiles**

- [ ] COPPA-compliant family registration: parent account first, then add children (DOB, first name)
- [ ] Kid-selector landing page (default view on login); each child has own identifier + points balance
- [ ] Parent dashboard behind PIN: set per-child item cap, view all kids, add bonus magic, Naughty/Nice vote
- [ ] Naughty/Nice vote: one daily vote per child (Nice/Naughty); missed days auto-resolve as Nice; resets Jan 1
- [ ] Parent alias toggle: family name or alias on public QR payment page

**Deed flow**

- [ ] Deed catalog UI: browsable list of preset deeds + “Other” free-text field; parent selects and submits
- [ ] Earn magic QR code: generated per deed submission; unique, single-use, ties to that deed record
- [ ] Community member landing page (from QR scan): shows deed, child alias, tip options ($5 / $10 / $25 / Other)
- [ ] Three tip outcomes: pay now (Stripe), say thank you (confirms deed, no payment), pay later (Twilio SMS link)
- [ ] Deed verification: recipient action triggers deed confirmation + point award to child
- [ ] Outside donation QR: kid can share family QR without a deed attached (pure donation link)

**Community member experience**

- [ ] No account required to tip; Stripe Guest Checkout
- [ ] 7-day SMS pay-later links; expired links show a friendly message

## Phase 5 — Payments & Points Engine

**Apr – Jun 2027**

The financial layer. Every dollar in and out flows through Stripe; every point has a paper trail.

**Stripe integration**

- [ ] Stripe Elements embedded in family and community-member pages (no redirects)
- [ ] Payment Intents for one-time tips (webhook handler done in Phase 1; "All tips are final" shown before paying: no-refunds policy)
- [ ] Store payouts recorded by admin (paid by check/outside the app; no Stripe Connect)
- [ ] Parent bonus magic: parent pays via Stripe; converts at $1.50 = 1 point, credited to chosen child
- [ ] Pay-later: Twilio sends SMS with Stripe Payment Link; link expires in 7 days via webhook

**Point accounting**

- [ ] Transaction ledger: every point earned, spent, escrowed, and refunded logged with timestamp and source
- [ ] Real-time balance display per child
- [ ] $1.50 = 1 point conversion applied server-side (never client-trusted)
- [ ] Platform profit tracked: Spirit O Santa margin = tip collected minus wholesale payout to store

**Corporate donation page**

- [ ] Public page at spiritofsanta.com/donate: donate to all kids or filter by zip code
- [ ] Stripe Checkout for corporate donations; points distributed pro-rata to eligible children
- [ ] Tax receipt email (Edynsgate 501c3) auto-generated for donations above a threshold (set in admin)

**Season-end handling**

- [ ] Dec 25 cron: flag all unfunded items; notify parents of “pay-up” option
- [ ] Parent pay-up: Stripe payment covers funding gap; item moves to fully funded and locks
- [ ] Jan 1 cron: unclaimed pooled funds retained by Spirit O Santa; point balances reset to zero

## Phase 6 — Wish List & Fulfillment

**Jun – Aug 2027** · ✅ built and reviewed 2026-11-06 (details in docs/CODEMAP.md)

Where magic points become Christmas presents.

**Browsing & adding**

- [x] National store + item browser (all stores, search + sort by category, store name, price)
- [x] Item detail page: photo, name, store, price in magic points, funding progress bar
- [x] Add to list: requires ≥1 unallocated point; system escrows as many of kid’s available points as the item costs
- [x] Parent-set item cap enforced at add time
- [x] Kids can share individual items via link/QR while browsing

**Funding & lock logic**

- [x] Funding progress tracked per item per child (escrowed points + incoming tips allocated to item)
- [x] Fully funded trigger: when item reaches 100% → start 30-day clock
- [x] 30-day lock: fully funded + 30 days on list → item status = LOCKED, cannot be removed
- [x] Pre-lock removal: returns all escrowed points to child’s balance
- [x] Dec 1 freeze: no list changes after Dec 1 regardless of lock status

**Fulfillment**

- [x] Store notification on full funding: email + in-app alert to store owner and reps with item, quantity, and Spirit O Santa shipping address
- [x] Store rep marks item as shipped in store app
- [x] Spirit O Santa admin confirms receipt and logs delivery to family
- [x] Family notified when item is on its way

## Phase 7 — PWA & Push Notifications

**Aug – Sep 2027**

- [ ] Push-only service worker (no offline/install). Note: iPhones only allow web push for sites added to the Home Screen as a web app, so iOS users may need SMS/email instead (decide in Phase 7)
- [ ] Home-screen icon tested on iOS Safari and Android Chrome
- [ ] FCM tokens stored per user; notification permission requested at key moments (first deed, first point)
- [ ] Notification triggers implemented and tested:
  - Magic received (tip confirmed or parent bonus added)
  - Deed complete (recipient confirmed)
  - Item locked in (fully funded + 30 days)
  - Dec 1 cutoff reminder (sent Nov 28)
  - Full funding needed (sent when item is ≥90% funded)
- [ ] Notification preference settings in parent dashboard (opt out per category)
- [ ] Fallback: email notification for users who block push

## Phase 8 — Localization, QA & Compliance

**Sep 2027**

- [ ] Full Spanish translation audit: all UI strings, emails, SMS, push notifications
- [ ] COPPA compliance review: parental consent flow, data minimization, deletion rights, privacy policy
- [ ] Security audit: auth hardening, Stripe webhook signature verification, MongoDB injection protection, rate limiting on tip endpoints
- [ ] Load testing: simulate Oct 1 traffic spike across all three apps
- [ ] UAT with 10–20 beta families and 5–10 beta stores in Storm Lake area
- [ ] Content moderation workflow test: submit flagged deeds and items, verify admin queue
- [ ] Cross-browser and cross-device testing (iOS Safari, Android Chrome, desktop Chrome/Firefox)
- [ ] Accessibility pass: WCAG 2.1 AA for family-facing pages (kids + parents)

## Phase 8.5 — UI & Visual Design

**Sep 2027 (or earlier: development is running months ahead)**

**Starts with questions, not code:** before any design or code change, go through a detailed set of questions
with the owner about the look and behaviour (mood, colours, fonts, logo, imagery, tone for kids vs parents,
motion, reference sites) and agree on the answers.

A phase of ONLY look and feel: no new features, no changes to business rules or money logic.
Every screen keeps its current behaviour; the end-to-end tests must stay green after each change.

**Visual identity**

- [ ] Logo, colour palette, typography and illustration style: festive and kid-friendly, but trustworthy for parents and stores
- [ ] Design tokens in `packages/ui` (colours, spacing, radius, shadows, type scale) as the single source for all three apps

**Shared design system (`packages/ui`)**

- [ ] Restyle the shared components: buttons, cards, forms, alerts, navigation, tables, progress bars, badges
- [ ] Consistent empty, loading and error states on every page
- [ ] Gentle motion and "celebration" moments (e.g. a gift becomes fully funded), respecting reduced-motion settings

**Per app**

- [ ] Family app, kid screens: playful, big touch targets, gift photos, friendly progress and status
- [ ] Family app, parent screens: calm and clear (PIN, payments, pay-ups, settings)
- [ ] Store app: clean dashboard, Orders and Items pages that are quick to scan
- [ ] Admin app: dense but readable work queues (stores, deeds, fulfilment, donations)
- [ ] Public pages (home, donate, deed QR page, legal pages): a first impression that builds trust

**Everywhere**

- [ ] Phone-first layouts checked on small phones, tablets and desktop
- [ ] Email templates match the new look (all transactional emails)
- [ ] Wording pass in English and Spanish (short, warm, consistent)
- [ ] Visual accessibility: WCAG 2.1 AA contrast, visible focus, readable text sizes
- [ ] Before/after screenshots of every page for sign-off

## Phase 9 — Beta Launch & Live Season

**Oct 1 – Dec 25, 2027**

| Date | Event |
| --- | --- |
| Oct 1 | Season opens; beta families and stores go live |
| Oct 1–31 | Bug triage; onboard additional stores and families |
| Nov 1 | Full public launch — open registration nationwide |
| Nov 28 | Push Dec 1 cutoff reminder to all families |
| Dec 1 | Wish list freeze activates; full-funding prompts start; items begin mailing as funded |
| Dec 10 | Last day stores can ship and have items arrive by Dec 25 (buffer) |
| Dec 25 | Season closes; unfunded item handling triggered |
| Jan 1, 2028 | Points reset to zero; Q1 store item-list window opens for 2028 season |

## Critical Milestones & Dependencies

| Date | Milestone | Blocks |
| --- | --- | --- |
| Nov 30, 2026 | Phase 1 complete — monorepo, DB, auth, Stripe, FCM scaffolded | All phases |
| Jan 1, 2027 | Store App MVP live | Q1 store item-list window |
| Mar 31, 2027 | Q1 window closes — stores have locked in item lists | Season item catalog |
| Apr 1, 2027 | Store item lists locked for 2027 season | Wish list browsing |
| Apr 30, 2027 | Family App core live (Phase 4) | Payments phase |
| Jun 30, 2027 | Payments & Points engine live (Phase 5) | Wish list phase |
| Aug 31, 2027 | Wish List & Fulfillment live (Phase 6) | PWA phase |
| Sep 15, 2027 | PWA + Push Notifications live (Phase 7) | QA phase |
| Sep 30, 2027 | QA, COPPA sign-off, Spanish complete (Phase 8) | Launch |
| Sep 30, 2027 | UI & visual design complete (Phase 8.5) | Launch |
| Oct 1, 2027 | 🎅 Season opens — beta launch | — |
| Nov 1, 2027 | Full public launch | — |
| Dec 1, 2027 | Wish list freeze | — |
| Dec 25, 2027 | Season closes | — |
| Jan 1, 2028 | Points reset; 2028 Q1 window opens | — |

## Claude in VS Code Setup Notes

### CLAUDE.md Placement

Create one `CLAUDE.md` at the **monorepo root** for shared conventions, and optionally a second inside each app workspace for app-specific context. Claude in VS Code reads the nearest `CLAUDE.md` up the tree, so the root file is always in scope.

**Recommended root `CLAUDE.md` sections:**

```markdown
# Spirit O Santa — Monorepo

## Project structure
Three Next.js apps (App Router) + shared packages in a Turborepo monorepo.
All apps share one MongoDB cluster (env var: MONGODB_URI).

## Apps
- apps/family   → spiritofsanta.com
- apps/store    → store.spiritofsanta.com
- apps/admin    → admin.spiritofsanta.com

## Shared packages
- packages/db        → Mongoose models & connection helper
- packages/auth      → NextAuth config & role helpers
- packages/ui        → Shared React components
- packages/lib       → Conversion rates, constants, utilities

## Key constants (never hard-code)
- DOLLARS_PER_POINT = 1.50  (server-side only — packages/lib/constants.ts)
- Season open: Oct 1 | Freeze: Dec 1 | Close: Dec 25 | Reset: Jan 1

## Conventions
- TypeScript strict mode everywhere
- Zod for all API route input validation
- Server Actions over client fetch where possible
- Never trust client-sent point values — recompute server-side
- All Stripe calls server-side only (never expose secret key)
- Role enum: child | parent | store_owner | store_rep | admin
```

### Recommended VS Code Extensions

| Extension | Purpose |
| --- | --- |
| ESLint | Linting (use `eslint-config-next`) |
| Prettier | Formatting |
| Tailwind CSS IntelliSense | Class autocomplete |
| Prisma / MongoDB for VS Code | Schema & collection browsing |
| Thunder Client | API route testing without Postman |
| DotENV | `.env.local` syntax highlighting |
| GitLens | Blame + history inline |
| Turbo Console Log | Quick debug logging |

### .env.local Handling

Each app has its own `.env.local` — **never commit any `.env*` file**. Keep a `.env.example` per app with all required keys and no values. Minimum keys per app:

```
# Shared (copy to all three apps)
MONGODB_URI=
NEXTAUTH_SECRET=
NEXTAUTH_URL=

# Family app
STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
FCB_VAPID_PUBLIC_KEY=
FCB_VAPID_PRIVATE_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Store app (Vercel adds these when the Blob store is connected; on Vercel it uses OIDC)
BLOB_STORE_ID=
BLOB_READ_WRITE_TOKEN=

# Family + admin (not secret: lets <Image> show store photos)
BLOB_STORE_ID=

# Admin app
(no additional keys beyond shared)
```

### Working with Claude in VS Code

- Open the **monorepo root** as your VS Code workspace so Claude has full context across all apps and packages.
- Reference `packages/db/models/` when asking Claude to extend the schema — paste the relevant model so it stays consistent.
- When asking Claude to write an API route, tell it which app it belongs to and which Mongoose models it touches.
- For Stripe webhook handlers, always remind Claude: *verify signature first, then process* — never process unverified events.
- Use `// TODO(claude):` comments as inline prompts; Claude picks them up in context.
- Keep sessions focused: one feature or one file set per session to avoid context drift.
- After any AI-generated migration or model change, run `ts-tsc --noEmit` to catch type errors before committing.
