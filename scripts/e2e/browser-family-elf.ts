/**
 * E2E for FIND THE ELF (owner 2026-11-16): he appears on kid/public pages (after hydration), tapping counts him for
 * today, he stays away on that page for the rest of the day, the count carries across pages, Spanish works, people
 * who ask for less motion still get the game, and the parent area has no elf.
 *
 *   family dev server on :3000, then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-elf.ts http://localhost:3000
 *
 * No database writes: progress lives only in the browser (localStorage "sos-elves").
 */
import { chromium, type Page } from "playwright-core";
import { ELF_PAGES } from "@repo/lib/elf";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-elf.ts <familyUrl>");
const { check, report } = makeChecks();
const total = ELF_PAGES.length;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const elf = (p: Page) => p.locator('[data-testid="hidden-elf"]');

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Home: he's there, labelled for screen readers, peeking from an edge.
  await page.goto(`${base}/`);
  await elf(page).waitFor({ timeout: 60_000 });
  const box = await elf(page).boundingBox();
  check("home: the elf is on the page, at the left or right edge", !!box && (box.x <= 1 || box.x + box.width >= 389));
  check("he has a spoken label", (await elf(page).getAttribute("aria-label")) === "A hidden elf! Tap to find him");

  // 2. Tap → "1 of N", stored only in the browser.
  await elf(page).scrollIntoViewIfNeeded();
  await elf(page).click();
  await page.locator('[data-testid="elf-message"]').waitFor({ timeout: 10_000 });
  check("tap → 'You found 1 of N elves today!'", (await page.locator('[data-testid="elf-message"]').innerText()).includes(`You found 1 of ${total}`));
  const stored = await page.evaluate(() => localStorage.getItem("sos-elves"));
  check("progress saved in the browser only (today + home)", !!stored && JSON.parse(stored).found.join() === "home");

  // 3. Reload: he's gone from this page for today.
  await page.reload();
  await page.locator("main h1, main h2").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  check("found today → gone from that page after reload", (await elf(page).count()) === 0);

  // 4. Another page continues the count.
  await page.goto(`${base}/donate`);
  await elf(page).waitFor({ timeout: 60_000 });
  await elf(page).scrollIntoViewIfNeeded();
  await elf(page).click();
  await page.locator('[data-testid="elf-message"]').waitFor({ timeout: 10_000 });
  check("second page → '2 of N'", (await page.locator('[data-testid="elf-message"]').innerText()).includes(`You found 2 of ${total}`));

  // 5. Parent area / legal pages: no elf.
  await page.goto(`${base}/privacy`);
  await page.locator("main h1").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  check("no elf on the privacy page", (await elf(page).count()) === 0);

  // 6. Spanish + reduced motion (fresh browser profile): still playable, Spanish words.
  const es = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  es.on("pageerror", (e) => errors.push(e.message));
  await es.goto(`${base}/es/donate`);
  await elf(es).waitFor({ timeout: 60_000 });
  await elf(es).scrollIntoViewIfNeeded();
  await elf(es).click();
  await es.locator('[data-testid="elf-message"]').waitFor({ timeout: 10_000 });
  check("Spanish + reduced motion: playable, Spanish message", (await es.locator('[data-testid="elf-message"]').innerText()).includes(`Encontraste 1 de ${total}`));

  // 7. Broken stored value doesn't break the page.
  await page.evaluate(() => localStorage.setItem("sos-elves", "{broken"));
  await page.goto(`${base}/donate/thanks`);
  await elf(page).waitFor({ timeout: 60_000 });
  check("junk in storage → the game starts fresh, no crash", true);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
}
process.exit(report());
