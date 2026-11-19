/**
 * Real-browser E2E (Edge) for the public partners page (owner 2026-11-18, founding-partners "Slice P"):
 * /partners tiles from the Store collection (status badges, logo rules, hidden statuses, order), the admin
 * "mark declined" service, and where a tile leads (/partners/<slug>): sign-up invitation, one kid → that kid's
 * gifts from the store, several kids → "Whose wish list?", no registered kid, store not approved yet.
 *
 *   family dev server (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-partners.ts http://localhost:3000
 *
 * Needs the season OPEN today. Creates and removes all its own data (*_dev database only).
 */
import { randomBytes } from "node:crypto";
import mongooseLib from "mongoose";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Family, Item, Kid, Store, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { blobPublicHost } from "@repo/storage/image-rules";
import { declineStoreInvite, inviteStore } from "@repo/stores/admin";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-partners.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `partner pass ${tag}`;
const year = getSeasonYear(new Date());
const oid = () => new mongooseLib.Types.ObjectId();

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");

// Stores in every status (raw inserts: owners/photos aren't needed here). Names sort A→Z inside each group.
const host = blobPublicHost(process.env.BLOB_STORE_ID);
const logo = (id: mongooseLib.Types.ObjectId) => ({ url: `https://${host}/stores/${id}/123e4567-e89b-42d3-a456-426614174000.webp`, pathname: `stores/${id}/123e4567-e89b-42d3-a456-426614174000.webp` });
const ids = { a: oid(), b: oid(), proc: oid(), unconf: oid(), inv: oid(), dec: oid(), rej: oid(), sus: oid() };
// Self-sign-up owners: one CONFIRMED (listed as Processing), one not confirmed (never listed: review 2026-11-18).
const procOwner = await User.create({ email: `e2e-partner-proc-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "store_owner", status: "active" });
const unconfOwner = await User.create({ email: `e2e-partner-unconf-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "store_owner", status: "pending" });
const decEmail = `e2e-partner-dec-${tag}@spiritofsanta.test`;
const slug = (k: string) => `e2e-p-${k}-${tag}`;
const now = new Date();
const store = (k: keyof typeof ids, name: string, status: string, extra: object = {}) => ({ _id: ids[k], name: `${name} ${tag}`, slug: slug(k), status, createdAt: now, updatedAt: now, ...extra });
await Store.collection.insertMany([
  store("b", "Bbb Bikes", "approved"),
  store("a", "Aaa Toys", "approved", { logo: logo(ids.a) }),
  store("proc", "Ccc Crafts", "pending", { ownerUserId: procOwner._id, logo: logo(ids.proc) }), // logo NOT shown: not approved
  store("unconf", "Cxx Unconfirmed", "pending", { ownerUserId: unconfOwner._id }),
  store("inv", "Ddd Dolls", "invited"),
  store("dec", "Eee Electronics", "invited", { logo: logo(ids.dec), contact: { email: decEmail } }), // declined below, through the admin service
  store("rej", "Fff Rejected", "rejected"),
  store("sus", "Ggg Suspended", "suspended"),
]);
const mkItem = async (storeId: mongooseLib.Types.ObjectId, name: string) => {
  const _id = oid();
  await Item.collection.insertOne({ _id, storeId, seasonYear: year, name: `${name} ${tag}`, description: "A lovely gift.", category: `Toys${tag}`, priceCents: 1500, payoutCents: 1200, inventory: 3, status: "active", stats: { views: 0 }, createdAt: now, updatedAt: now });
  return _id;
};
const itemIds = [await mkItem(ids.a, "Kite"), await mkItem(ids.a, "Puzzle"), await mkItem(ids.b, "Bell")];

// Families: one registered kid (+ one not registered), two registered kids, none registered.
const registered = { status: "registered", registeredAt: now, method: "card" };
const users: mongooseLib.Types.ObjectId[] = [];
const families: mongooseLib.Types.ObjectId[] = [];
const mkFamily = async (name: string, kids: { firstName: string; registered: boolean }[]) => {
  const user = await User.create({ email: `e2e-partner-${name}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const family = await Family.create({ ownerUserId: user._id, familyName: `Partner${name}${tag}`, parentPinHash: await hashSecret("8153"), consent: { version: "test", acceptedAt: now } });
  await User.updateOne({ _id: user._id }, { $set: { familyId: family._id } });
  users.push(user._id);
  families.push(family._id);
  const made = [];
  for (const k of kids) made.push(await Kid.create({ familyId: family._id, firstName: k.firstName, birthYear: 2017, displayName: `${k.firstName[0]}.`, ...(k.registered ? { registration: registered } : {}) }));
  return { email: user.email, kids: made.map((k) => String(k._id)) };
};
const one = await mkFamily("one", [{ firstName: "Ivy", registered: true }, { firstName: "Unreg", registered: false }]);
const two = await mkFamily("two", [{ firstName: "Max", registered: true }, { firstName: "Zoe", registered: true }]);
const none = await mkFamily("none", [{ firstName: "Wait", registered: false }]);
users.push(procOwner._id, unconfOwner._id);
const adminUser = await User.create({ email: `e2e-partner-admin-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "admin", status: "active" });
users.push(adminUser._id);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const newPage = async () => {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
};
const open = async (p: Page, path: string) => {
  const res = await p.goto(`${base}${path}`);
  await p.locator("main:visible h1, main:visible h2").first().waitFor({ timeout: 60_000 });
  await p.waitForLoadState("networkidle");
  return res?.status() ?? 0;
};
async function signInAs(email: string) {
  const p = await newPage();
  await p.goto(`${base}/signin`);
  await p.waitForFunction(() => [...document.querySelectorAll("main button[type=submit]")].some((b) => b.checkVisibility() && !(b as HTMLButtonElement).disabled), undefined, { timeout: 60_000 });
  await p.fill('[name="email"]', email);
  await p.fill('[name="password"]', PW);
  await p.click("main:visible button[type=submit]");
  await p.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  return p;
}
const ours = (p: Page) => p.locator(`main:visible [data-testid="partner"][data-slug$="-${tag}"]`);

try {
  // 1. Admin service: an invited company that said no → declined (audited); a not-invited store can't be.
  const dec = await declineStoreInvite({ id: String(adminUser._id), role: "admin" }, String(ids.dec));
  const decAgain = await declineStoreInvite({ id: String(adminUser._id), role: "admin" }, String(ids.a));
  check("admin marks an invited company declined (audited); an approved store can't be",
    dec.ok && !decAgain.ok && (await Store.findById(ids.dec).lean())?.status === "declined" && !!(await AuditLog.exists({ action: "store.invite_declined", targetId: ids.dec })));
  const reinvite = await inviteStore({ id: String(adminUser._id), role: "admin" }, { storeName: "Eee Again", ownerEmail: decEmail, category: "toys", discountBps: 1000 }, "en");
  check("inviting a declined company again is refused (no duplicate tile)", !reinvite.ok && reinvite.error === "declinedBefore" && (await Store.countDocuments({ "contact.email": decEmail })) === 1);

  // 2. The public page.
  const anon = await newPage();
  check("/partners loads, header links to it", (await open(anon, "/partners")) === 200 && (await anon.locator('header a[href$="/partners"]').count()) > 0);
  const slugs = await ours(anon).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.slug));
  check("order: approved A→Z, processing, pending, declined; rejected, suspended + UNCONFIRMED sign-up hidden",
    JSON.stringify(slugs) === JSON.stringify([slug("a"), slug("b"), slug("proc"), slug("inv"), slug("dec")]), JSON.stringify(slugs));
  const joinHref = (p: Page) => p.locator('main:visible [data-testid="partners-join"]').getAttribute("href");
  // The store app's own sign-up (pending until an admin approves): STORE_APP_URL, localhost:3001 in dev.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const storeOrigin = new URL(process.env.STORE_APP_URL ?? "http://localhost:3001").origin;
  check("'Own a store? Join' links to the store app's sign-up", (await joinHref(anon)) === `${storeOrigin}/register`, (await joinHref(anon)) ?? "none");
  const statusOf = async (k: string) => (await anon.locator(`main:visible [data-slug="${slug(k)}"]`).getAttribute("data-status")) ?? "";
  check("status badges: approved / processing / pending / declined",
    (await statusOf("a")) === "approved" && (await statusOf("proc")) === "processing" && (await statusOf("inv")) === "pending" && (await statusOf("dec")) === "declined");
  const tile = (k: string) => anon.locator(`main:visible [data-slug="${slug(k)}"]`);
  check("store's own logo shown; no logo → the name instead", (await tile("a").locator("img").count()) === 1 && (await tile("b").locator("img").count()) === 0 && (await tile("b").innerText()).includes("Bbb Bikes"));
  check("a not-yet-approved store's logo is NOT shown (name only)", (await tile("proc").locator("img").count()) === 0 && (await tile("proc").innerText()).includes("Ccc Crafts"));
  check("declined: NO logo (even though one is stored), not a link, grumpy face + 'Declined'",
    (await tile("dec").locator("img").count()) === 0 && (await tile("dec").locator("a").count()) === 0 && (await tile("dec").locator("svg").count()) > 0 && (await tile("dec").innerText()).includes("Declined"));
  check("no North Star yet (store-linked gifts come in slice 3)", (await anon.locator('main:visible [data-testid="partner-donor"]').count()) === 0);
  // Streaming pages: notFound() inside Suspense shows the not-found page (status may stay 200, Next.js behaviour).
  const notFoundPage = async (k: string) => {
    await anon.goto(`${base}/partners/${slug(k)}`);
    await anon.locator("main:visible").getByText("Page not found").waitFor({ timeout: 60_000 }).catch(() => undefined);
    const text = await anon.locator("main:visible").innerText();
    return text.includes("Page not found") && !text.includes(tag);
  };
  check("rejected / suspended / declined / unconfirmed: 'Page not found', name never shown", (await notFoundPage("rej")) && (await notFoundPage("sus")) && (await notFoundPage("dec")) && (await notFoundPage("unconf")));

  // 3. A visitor taps a tile → sign up "to see what wonders await".
  await open(anon, "/partners");
  await tile("a").locator("a").click();
  await anon.locator('main:visible [data-testid="partner-signup"]').waitFor({ timeout: 60_000 });
  check("not signed in → sign-up invitation ('wonders await')", (await anon.locator("main:visible").innerText()).includes("what wonders await") && ((await anon.locator('main:visible [data-testid="partner-signup"]').getAttribute("href")) ?? "").endsWith("/register"));

  // 4. Parent with ONE registered kid → straight to that kid's gifts, this store only.
  const p1 = await signInAs(one.email);
  await p1.goto(`${base}/partners/${slug("a")}`);
  await p1.waitForURL((u) => u.pathname.endsWith(`/kids/${one.kids[0]}/gifts`) && u.searchParams.get("store") === slug("a"), { timeout: 60_000 });
  await p1.locator('main:visible [data-testid="store-filter"]').waitFor({ timeout: 60_000 });
  const grid = await p1.locator('main:visible [data-testid="gift-grid"]').innerText();
  check("one registered kid → that kid's gift list, only this store's gifts", grid.includes(`Kite ${tag}`) && grid.includes(`Puzzle ${tag}`) && !grid.includes(`Bell ${tag}`));
  check("the filter says which store, with 'Show all stores'", (await p1.locator('main:visible [data-testid="store-filter"]').innerText()).includes(`Aaa Toys ${tag}`));
  // Search keeps the store filter (hidden field in the GET form).
  await p1.fill('main:visible input[name="q"]', `Kite ${tag}`);
  await p1.locator('main:visible form[role="search"] button[type="submit"]').click();
  await p1.waitForURL((u) => u.searchParams.get("q") === `Kite ${tag}` && u.searchParams.get("store") === slug("a"), { timeout: 60_000 });
  check("searching keeps the store filter", true);
  await p1.locator('main:visible [data-testid="store-filter"] a').click();
  await p1.waitForURL((u) => !u.searchParams.has("store"), { timeout: 60_000 });
  check("'Show all stores' drops the filter", true);
  // A store that isn't approved yet: no gifts to show, says it is getting ready.
  await open(p1, `/partners/${slug("proc")}`);
  check("store not approved yet → 'getting ready', no redirect", (await p1.locator("main:visible").innerText()).includes("getting ready"));
  // An unknown store filter is ignored (all gifts), never an error.
  await open(p1, `/kids/${one.kids[0]}/gifts?store=${slug("rej")}`);
  check("a hidden store's slug in the URL is ignored (no filter shown)", (await p1.locator('main:visible [data-testid="store-filter"]').count()) === 0);

  // 5. Parent with TWO registered kids → "Whose wish list?".
  const p2 = await signInAs(two.email);
  await open(p2, `/partners/${slug("b")}`);
  const choices = await p2.locator('main:visible [data-testid="partner-kids"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  check("several kids → one link per registered kid to their gifts from this store",
    choices.length === 2 && two.kids.every((k) => choices.some((h) => h.endsWith(`/kids/${k}/gifts?store=${slug("b")}`))), JSON.stringify(choices));

  // 6. Parent with no registered kid.
  const p3 = await signInAs(none.email);
  await open(p3, `/partners/${slug("a")}`);
  check("no registered kid → nudge to finish registering", (await p3.locator("main:visible").innerText()).includes("Finish registering"));

  // 7. Spanish.
  const es = await newPage();
  await open(es, "/es/partners");
  check("Spanish page", (await es.locator("main:visible h1").innerText()).includes("Nuestras tiendas") && (await es.locator(`main:visible [data-slug="${slug("dec")}"]`).innerText()).includes("Rechazó"));
  check("Spanish join link goes to the Spanish store sign-up", (await es.locator('main:visible [data-testid="partners-join"]').getAttribute("href")) === `${storeOrigin}/es/register`);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const storeIds = Object.values(ids);
  await Item.collection.deleteMany({ _id: { $in: itemIds } });
  await Store.collection.deleteMany({ _id: { $in: storeIds } });
  await Kid.collection.deleteMany({ familyId: { $in: families } });
  await Family.collection.deleteMany({ _id: { $in: families } });
  await AuditLog.collection.deleteMany({ $or: [{ targetId: { $in: storeIds } }, { actorUserId: { $in: users } }] });
  await User.collection.deleteMany({ _id: { $in: users } });
  await mongoose.disconnect();
}
process.exit(report());
