/**
 * Real-browser page audit (Edge), Phase 8.5.4. Every main page of all three apps, in LIGHT and DARK mode:
 * 1. passes the WCAG 2.1 AA colour-contrast rule (4.5:1 normal text, 3:1 large text), measured by
 *    axe-core (the same engine as browser accessibility dev tools);
 * 2. keeps every form field inside its card (no field sliding under the next card: the store profile's
 *    City/State/ZIP row did, see packages/ui/src/layout.ts).
 *
 *   all three dev servers running (family :3000, store :3001, admin :3002), then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *     scripts/e2e/browser-page-audit.ts http://localhost:3000 http://localhost:3001 http://localhost:3002 [--shots <dir>]
 *   (admin env first for MFA_ENCRYPTION_KEY; the later file wins for shared names.)
 *
 * Teaching notes:
 * - Pages run with reduced motion so snow and fade-ins are off: axe measures what is on screen right
 *   now, and a half-faded element would give a false result.
 * - axe reports "incomplete" when it cannot tell (text over an image or gradient). Those are listed
 *   for a human to look at, not failed.
 * - Signed-in pages get their session cookie from next-auth's own endpoints (lib.ts signIn), so this
 *   tests colours, not sign-in forms. A page that redirects (PIN gate, etc.) is checked where it lands.
 *
 * *_dev database only; creates and removes its own data.
 */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { connectDb, Family, Item, Kid, Store, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { createMfaAdmin, makeChecks, signIn } from "./lib.ts";

const [family, store, admin, flag, shotsDir] = process.argv.slice(2);
if (!family || !store || !admin) throw new Error("usage: browser-page-audit.ts <familyUrl> <storeUrl> <adminUrl> [--shots <dir>]");
// Optional: also save a full-page screenshot of every page (both modes) for a human look/sign-off.
const shots = flag === "--shots" && shotsDir ? shotsDir : null;
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `contrast pass ${tag}`;
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");

// --- Test data: a family with a registered child and a HALF-funded gift (no "Fully funded!" dialog). ---
const oid = () => new mongoose.Types.ObjectId();
const parent = await User.create({ email: `e2e-contrast-p-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: parent._id, familyName: `Contrast${tag}`, parentPinHash: await hashSecret("8158"), consent: { version: "test", acceptedAt: new Date() } });
await User.updateOne({ _id: parent._id }, { $set: { familyId: fam._id } });
const kid = await Kid.create({ familyId: fam._id, firstName: `Ava${tag}`, birthYear: 2017, displayName: "A.", escrowedCentipoints: 1000, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const owner = await User.create({ email: `e2e-contrast-s-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "store_owner", status: "active", name: "Owner" });
const shop = await Store.create({
  name: `Contrast Shop ${tag}`, slug: `e2e-contrast-${tag}`, category: "toys", status: "approved", ownerUserId: owner._id, discountBps: 2000,
  contact: { email: owner.email, address: { line1: "1 Main", city: "Storm Lake", state: "IA", zip: "50588" } },
});
await User.updateOne({ _id: owner._id }, { $set: { storeId: shop._id } });
const itemId = oid();
const year = getSeasonYear();
await Item.collection.insertOne({ _id: itemId, storeId: shop._id, seasonYear: year, name: `Sled ${tag}`, priceCents: 3000, inventory: 3, status: "active", createdAt: new Date(), updatedAt: new Date() });
await WishListItem.collection.insertOne({ kidId: kid._id, familyId: fam._id, itemId, storeId: shop._id, seasonYear: year, costCentipoints: 2000, fundedCentipoints: 1000, status: "active", createdAt: new Date(), updatedAt: new Date() });
const adminUser = await createMfaAdmin(`e2e-contrast-a-${tag}@spiritofsanta.test`);

const k = `/kids/${kid._id}`;
/** Parent area: type the PIN (we are ON /parent/pin) so the pages behind it are checked, not the PIN form again. */
async function unlockPin(page: Page) {
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled); // hydrated
  }, undefined, { timeout: 60_000 });
  await page.fill('[name="pin"]', "8158");
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
}

// `afterFirst` runs once after the FIRST path is checked (the parent's PIN page is checked locked, then unlocked).
const PAGES: { app: string; base: string; login?: () => Promise<string | undefined>; afterFirst?: (p: Page) => Promise<void>; paths: string[] }[] = [
  { app: "family", base: family, paths: ["/", "/donate", "/signin", "/register", "/forgot-password", "/privacy", "/terms", "/text-messages", "/es", "/no-such-page"] },
  {
    app: "family (parent)", base: family, login: async () => (await signIn(family, parent.email, PW))?.cookie, afterFirst: unlockPin,
    paths: ["/parent/pin", "/", "/parent", "/parent/notifications", "/parent/address", "/parent/payup", "/parent/bonus", "/parent/kids/new", `/parent/kids/${kid._id}`, k, `${k}/gifts`, `${k}/gifts/${itemId}`, `${k}/deed`],
  },
  { app: "store", base: store, paths: ["/signin", "/register"] },
  {
    app: "store (owner)", base: store, login: async () => (await signIn(store, owner.email, PW))?.cookie,
    paths: ["/dashboard", "/dashboard/items", "/dashboard/items/new", "/dashboard/orders", "/dashboard/profile", "/dashboard/reps"],
  },
  { app: "admin", base: admin, paths: ["/signin"] },
  {
    app: "admin (signed in)", base: admin, login: async () => (await signIn(admin, adminUser.email, adminUser.password, await adminUser.nextCode()))?.cookie,
    paths: ["/", "/deeds", "/donations", "/fulfilment", "/moderation", "/payouts", "/season", "/settings", "/stores", "/users"],
  },
];

type AxeNode = { target: string[]; any: { data?: { contrastRatio?: number; expectedContrastRatio?: string; fgColor?: string; bgColor?: string } }[] };
type AxeResult = { violations: { nodes: AxeNode[] }[]; incomplete: { nodes: AxeNode[] }[] };

/** Run ONLY axe's colour-contrast rule (WCAG 2 AA thresholds) on what is on screen now. */
async function contrast(page: Page): Promise<AxeResult> {
  await page.addScriptTag({ path: AXE });
  return (await page.evaluate(() =>
    (window as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe.run({ runOnly: { type: "rule", values: ["color-contrast"] } }),
  )) as AxeResult;
}

/**
 * Visible form fields poking out of their box: the Card (.shadow-card from @repo/ui/card) when inside one,
 * otherwise <main>. 1px slack for rounding. Returns the field names.
 */
function fieldsOutsideBox(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("main input:not([type=hidden]), main select, main textarea")]
      .filter((el) => el.checkVisibility())
      // Skip what is hidden from people on purpose (the sign-up honeypot sits off-screen in an aria-hidden box).
      .filter((el) => !el.closest('[aria-hidden="true"]'))
      .filter((el) => {
        const box = el.closest(".shadow-card") ?? el.closest("main");
        if (!box) return false;
        const r = el.getBoundingClientRect();
        const c = box.getBoundingClientRect();
        return r.left < c.left - 1 || r.right > c.right + 1;
      })
      .map((el) => (el as HTMLInputElement).name || el.tagName),
  );
}

const errors: string[] = [];
const cspViolations: string[] = [];

/**
 * Phase 8: record anything OUR Content-Security-Policy blocks (it must block nothing we use). Only the top
 * page (Stripe's own frames have their own policies) and only enforced blocks (not "report-only").
 */
async function watchCsp(ctx: BrowserContext, label: string) {
  await ctx.exposeFunction("__cspViolation", (v: string) => cspViolations.push(`${label}: ${v}`));
  await ctx.addInitScript(() => {
    if (window.top !== window) return;
    document.addEventListener("securitypolicyviolation", (e) => {
      if (e.disposition !== "enforce") return;
      (window as unknown as { __cspViolation: (v: string) => void }).__cspViolation(`${location.pathname} ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}
const incompletes: string[] = [];
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const group of PAGES) {
    const cookie = group.login ? await group.login() : undefined;
    if (group.login) check(`${group.app}: signed in`, !!cookie);
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme, reducedMotion: "reduce" });
      await watchCsp(ctx, group.app);
      if (cookie) {
        // "a=1; b=2" -> cookies for this app's origin (dev apps differ only by port; cookies ignore ports,
        // which is why each app gets its own browser context).
        await ctx.addCookies(cookie.split("; ").map((p) => ({ name: p.slice(0, p.indexOf("=")), value: p.slice(p.indexOf("=") + 1), url: group.base })));
      }
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`${group.app} ${e.message}`));
      for (const [i, path] of group.paths.entries()) {
        await page.goto(`${group.base}${path}`);
        await page.locator("main:visible").first().waitFor({ timeout: 60_000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        const res = await contrast(page);
        const bad = res.violations.flatMap((v) => v.nodes).map((n) => {
          const d = n.any[0]?.data;
          return `${n.target.join(" ")} ${d?.fgColor}/${d?.bgColor} ${d?.contrastRatio}:1 (needs ${d?.expectedContrastRatio})`;
        });
        const landed = new URL(page.url()).pathname;
        check(`${scheme.padEnd(5)} ${group.app} ${path}${landed.endsWith(path) ? "" : ` -> ${landed}`}`, bad.length === 0, bad.slice(0, 6).join(" | "));
        const unsure = res.incomplete.flatMap((v) => v.nodes).length;
        if (unsure) incompletes.push(`${scheme} ${group.app} ${path}: ${unsure}`);
        if (scheme === "light") {
          // Layout (light pass only: colours don't move boxes). Desktop width, then a tablet width (700px),
          // where three fields share a row in a narrower card: the store profile overflow showed there too.
          for (const width of [1280, 700]) {
            await page.setViewportSize({ width, height: 900 });
            const outside = await fieldsOutsideBox(page);
            check(`layout ${width}px ${group.app} ${path}: fields inside their card`, outside.length === 0, outside.join(", "));
          }
          await page.setViewportSize({ width: 1280, height: 720 }); // Playwright's default, as before
        }
        if (shots) {
          // Readable file names; ids replaced so names stay stable between runs.
          const name = `${group.app}${path}`.replace(/[0-9a-f]{24}/g, "id").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "");
          await page.screenshot({ path: `${shots}/${name}-${scheme}.png`, fullPage: true });
        }
        if (i === 0 && group.afterFirst) await group.afterFirst(page);
      }
      await ctx.close();
    }
  }

  // Stripe under our CSP: open a real (test-mode) Embedded Checkout from the child's donation link (/k/<token>,
  // always open in season; /donate needs admin Settings) and wait until Stripe's form has RENDERED inside its
  // frame. A frame blocked by frame-src keeps its <iframe> element but stays empty, so "element exists" proves
  // nothing. Starting a checkout stores nothing in our database (only Stripe's test-mode session).
  {
    const parentCtx = await browser.newContext();
    const cookie = (await signIn(family, parent.email, PW))?.cookie ?? "";
    await parentCtx.addCookies(cookie.split("; ").map((p) => ({ name: p.slice(0, p.indexOf("=")), value: p.slice(p.indexOf("=") + 1), url: family })));
    const parentPage = await parentCtx.newPage();
    await parentPage.goto(`${family}/kids/${kid._id}`);
    const link = (await parentPage.locator("main:visible img[data-donate-url]").first().getAttribute("data-donate-url", { timeout: 60_000 })) ?? "";
    await parentCtx.close();
    check("child's donation link found for the Stripe check", link.startsWith(`${family}/k/`));

    const ctx = await browser.newContext({ reducedMotion: "reduce" }); // a stranger: no cookies
    await watchCsp(ctx, "family (stripe)");
    const pay = await ctx.newPage();
    pay.on("pageerror", (e) => errors.push(`stripe ${e.message}`));
    await pay.goto(link);
    await pay.waitForFunction(() => {
      const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
      return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled); // hydrated
    }, undefined, { timeout: 60_000 });
    await pay.locator('main input[name="amount"]').first().check();
    await pay.locator("main:visible button[type=submit]").click();
    const form = pay.frameLocator('[data-testid="stripe-checkout"] iframe').first().locator("input").first(); // a real form field (a blocked frame's error page has none)
    const rendered = await form.waitFor({ timeout: 60_000 }).then(() => true, () => false);
    await pay.waitForTimeout(3000); // let Stripe start its helper frames/requests
    check("Stripe Embedded Checkout renders under our CSP", rendered);
    await ctx.close();
  }

  // Negative control: prove the checker CAN fail (a check that never fails proves nothing).
  // #aaa on white is about 2.3:1, well under 4.5:1.
  const probe = await browser.newPage();
  await probe.setContent('<main><p style="color:#aaaaaa;background:#ffffff;font-size:16px">Too faint to read</p></main>');
  check("negative control: axe flags grey-on-white text", (await contrast(probe)).violations.length === 1);
  await probe.close();

  // CSP negative control: on a real app page, an image from an unknown site must be BLOCKED and reported.
  // (Own page, no init script: this violation must not count against "blocked nothing" below.)
  const cspProbe = await browser.newPage();
  await cspProbe.goto(`${family}/signin`);
  const blocked = await cspProbe.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener("securitypolicyviolation", (e) => resolve(e.violatedDirective), { once: true });
        const img = document.createElement("img");
        img.src = "https://example.com/tracker.png";
        document.body.append(img);
        setTimeout(() => resolve("not blocked"), 5000);
      }),
  );
  check("negative control: CSP blocks an image from an unknown site", blocked.startsWith("img-src"), blocked);
  check("family pages send the security headers", await (async () => {
    const h = (await cspProbe.request.get(`${family}/`)).headers();
    return !!h["content-security-policy"]?.includes("frame-ancestors 'none'") && h["x-content-type-options"] === "nosniff";
  })());
  await cspProbe.close();
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("Content-Security-Policy blocked nothing", cspViolations.length === 0, [...new Set(cspViolations)].slice(0, 5).join(" | "));
} finally {
  await browser?.close();
  await Promise.all([
    WishListItem.collection.deleteMany({ kidId: kid._id }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.deleteOne({ _id: shop._id }),
    Kid.deleteOne({ _id: kid._id }),
    Family.deleteOne({ _id: fam._id }),
    User.deleteMany({ _id: trusted({ $in: [parent._id, owner._id, adminUser.id] }) }),
  ]);
  await mongoose.disconnect();
}
if (incompletes.length) console.log(`axe could not decide (text over images/gradients; look by eye):\n  ${incompletes.join("\n  ")}`);
process.exitCode = report();
