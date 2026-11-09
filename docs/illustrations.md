# Illustrations (family app): files in `apps/family/public/illustrations/`

These are **placeholders** (Phase 8.5, "Winter Night"). To use a custom graphic, **replace the file and
keep its name**: the app picks it up with no code change. Prefer SVG; a PNG/WebP works too if you
also update the path in `apps/family/lib/illustrations.ts` (the ONE list of illustration paths).

| File | Where it shows | Shape |
| --- | --- | --- |
| `gift-box.svg` | "Fully funded!" celebration; the wrapped-gift picture of a SURPRISE gift on the child's wish list (2026-11-08) | square |

**The home page hero (cottage, moon, snow) is not a file** since the Winter Magic / Festive themes (2026-11-08). It's
drawn in code, `apps/family/components/hero-scene.tsx`, so the theme switch can recolour it instantly through CSS
variables (`apps/family/app/themes.css`). Swapping it for an artist's version means replacing that component, keeping
it word-free, `aria-hidden`, and its animations off for reduced motion.

Rules for replacements:

- No photos of real children (privacy).
- Keep important content away from the bottom ~20% (the page content overlaps it a little on phones).
- Animations inside an SVG are fine; wrap them in `@media (prefers-reduced-motion: reduce) { … animation: none }`
  like the placeholders do (people who ask their device for less motion must not see them).
- Text inside images can't be translated: keep images word-free.
