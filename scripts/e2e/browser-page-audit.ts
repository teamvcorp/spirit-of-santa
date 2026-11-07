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
import { chromium, type Browser, type Page } from "playwright-core";
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

const errors: string[] = [];
const incompletes: string[] = [];
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const group of PAGES) {
    const cookie = group.login ? await group.login() : undefined;
    if (group.login) check(`${group.app}: signed in`, !!cookie);
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme, reducedMotion: "reduce" });
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
        // Fields poking out of their card (Card = the .shadow-card box from @repo/ui/card). 1px slack for rounding.
        const outside = await page.evaluate(() =>
          [...document.querySelectorAll("main input:not([type=hidden]), main select, main textarea")]
            .filter((el) => el.checkVisibility())
            // Skip what is hidden from people on purpose (the sign-up honeypot sits off-screen in an aria-hidden box).
            .filter((el) => !el.closest('[aria-hidden="true"]'))
            .filter((el) => {
              const card = el.closest(".shadow-card");
              if (!card) return false;
              const r = el.getBoundingClientRect();
              const c = card.getBoundingClientRect();
              return r.left < c.left - 1 || r.right > c.right + 1;
            })
            .map((el) => (el as HTMLInputElement).name || el.tagName),
        );
        if (scheme === "light") check(`layout ${group.app} ${path}: fields inside their card`, outside.length === 0, outside.join(", "));
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

  // Negative control: prove the checker CAN fail (a check that never fails proves nothing).
  // #aaa on white is about 2.3:1, well under 4.5:1.
  const probe = await browser.newPage();
  await probe.setContent('<main><p style="color:#aaaaaa;background:#ffffff;font-size:16px">Too faint to read</p></main>');
  check("negative control: axe flags grey-on-white text", (await contrast(probe)).violations.length === 1);
  await probe.close();
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
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
