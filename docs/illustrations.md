# Illustrations (family app): files in `apps/family/public/illustrations/`

These are **placeholders** (Phase 8.5, "Winter Night"). To use a custom graphic, **replace the file and
keep its name**: the app picks it up with no code change. Prefer SVG; a PNG/WebP works too if you
also update the path in `apps/family/lib/illustrations.ts` (the ONE list of illustration paths).

| File | Where it shows | Shape |
| --- | --- | --- |
| `house-night.svg` | Home page hero, dark mode ("starry night") | wide, about 13:10 (390×300) |
| `house-day.svg` | Home page hero, light mode ("snowy day") | wide, about 13:10 (390×300) |
| `gift-box.svg` | "Fully funded!" celebration | square |

Rules for replacements:

- No photos of real children (privacy).
- Keep important content away from the bottom ~20% (the page content overlaps it a little on phones).
- Animations inside an SVG are fine; wrap them in `@media (prefers-reduced-motion: reduce) { … animation: none }`
  like the placeholders do (people who ask their device for less motion must not see them).
- Text inside images can't be translated: keep images word-free.
