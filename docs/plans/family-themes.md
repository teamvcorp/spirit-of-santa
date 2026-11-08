# Family site: Winter Magic / Festive themes (owner, 2026-11-08)

Source mockups (owner's machine, not in the repo): `C:\Users\maste\Santa\mockups\home-two-themes.dc.html` (colour table
in its `themeTable()`), handoff + audit in `C:\Users\maste\Santa\notes\`. **UI and copy only: no feature changes.**

## Owner decisions (2026-11-08)
- Copy: the mockup's tone, but **facts corrected** to match how the site works.
- Live numbers (kids registered, Magic pooled): **not now**. The band shows the countdown only.
- Themes: **both, Winter Magic default**, with a header switch remembered on the device. They **replace device light/dark**
  on the family site (everyone gets the night/festive hero, no more sunny day).
- Scope: **the whole family site** (home rebuilt + header, footer, background, kid band on every page). Store and admin
  are unchanged.

## How it works (technical)
- `apps/family/app/themes.css`. `html[data-theme]` (specificity 0,1,1) beats `:root` and the dark-mode `:root`, so the
  family site always uses the cream role tokens. `[data-theme=winter|festive]` holds the `--t-*` table. Tailwind's
  `dark:` variant is redefined in the family app so it never fires (device dark mode is ignored there).
- `<html data-theme="winter" suppressHydrationWarning>` is rendered on the server (also the no-JavaScript default).
  An inline `<head>` script reads `localStorage["sos.theme"]`, accepting only "winter" or "festive", and sets the
  attribute before the first paint. Following the Next 16 guide "preventing flash before hydration"
  (docs/vendor/next-theme-script.md).
- The choice is stored in **localStorage, not a cookie**. Nothing is sent to the server, and the pages stay
  prerendered. It holds only a look preference (no personal data). Noted for the lawyer packet.
- `ThemeSwitch` (client) has two `aria-pressed` buttons and re-applies in `useLayoutEffect` (dev Strict Mode re-mount).
- The hero art is ONE inline SVG component. Its fills use `style={{ fill: "var(--t-…)" }}`, because presentation
  attributes can't read CSS variables. It's decorative (`aria-hidden`), and every animation is off for reduced motion.
- The countdown uses `getSeasonState()` (admin-overridable dates, America/Chicago). It never uses a typed-in date.

## Copy facts (where the mockup was wrong)
- Deeds: the child shows a QR card to the person they helped; that person says thanks or tips. Parents don't "log" deeds.
- A plain thank-you earns no Magic. Tips do (`CENTS_PER_POINT`), as do parents' bonus Magic and Secret Santa gifts.
- Gifts are secured when fully funded (any time of year) and ship in December. Secret Santa gifts are shared on the
  freeze date (Dec 1 by default).
- The charity name and EIN come from admin Settings (`receiptsReady`), as on /donate. They are never typed into copy.
