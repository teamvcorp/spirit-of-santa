/**
 * Real-browser E2E (Edge) for Phase 2 slice 3: store owner dashboard (profile, photos, reps)
 * and rep invite acceptance. Runs against the DEV store server (emails printed to the log).
 *
 *   npx turbo run dev --filter=store   (log to a file)
 *   node --conditions=react-server --env-file=apps/store/.env.local \
 *        scripts/e2e/browser-store-dashboard.ts http://localhost:3001 <dev-log-file>
 *
 * Uses the REAL Blob store for the photo test (files are deleted at the end). Creates its own
 * stores/users in the *_dev DB and removes them afterwards.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { chromium, type Page } from "playwright-core";
import { ActionToken, AuditLog, connectDb, Store, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { deletePublicImage } from "@repo/storage/images";
import { blobPublicHost } from "@repo/storage/image-rules";
import { makeChecks } from "./lib.ts";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const [base, logFile] = process.argv.slice(2);
if (!base || !logFile) throw new Error("usage: <storeUrl> <devLog|none> [--prod]");
/** --prod: against `next start`. Real emails → Resend test inbox; rep steps needing emailed links are skipped. */
const PROD = process.argv.includes("--prod");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mail = (n: string) => (PROD ? `delivered+dash${n}${tag}@resend.dev` : `e2e-dash-${n}-${tag}@spiritofsanta.test`);
const PW = `dash pass ${tag}`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const hash = await hashSecret(PW);

async function storeWithOwner(n: string, status: string) {
  const owner = await User.create({ email: mail(n), passwordHash: hash, role: "store_owner", status: "active", name: `Owner ${n}` });
  const store = await Store.create({
    name: `Dash ${n} ${tag}`, slug: `dash-${n}-${tag}`, category: "toys", status, ownerUserId: owner._id, discountBps: 2000,
    contact: { email: mail(n), address: { line1: "1 Main", city: "Storm Lake", state: "IA", zip: "50588" } },
  });
  await User.updateOne({ _id: owner._id }, { $set: { storeId: store._id } });
  return { ownerId: String(owner._id), storeId: String(store._id) };
}
const A = await storeWithOwner("a", "approved");
const B = await storeWithOwner("b", "approved"); // a different owner (IDOR test)
const S = await storeWithOwner("s", "suspended");
const repEmail = mail("rep");

const log = () => readFileSync(logFile, "utf8");
async function emailedLink(to: string, template: string, path: string, notEqual?: string): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    const block = log().split("[email:dev] to=").filter((b) => b.startsWith(`${to} template=${template}`)).at(-1);
    const link = block && new RegExp(`https?://\\S+${path}\\?token=[A-Za-z0-9_-]+`).exec(block)?.[0];
    if (link && link !== notEqual) return link;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function newPage() {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => void d.accept()); // confirm("Remove …?")
  return p;
}
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll('main button[type="submit"]')];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
const mainText = (p: Page) => p.locator("main").innerText();
async function signInUI(p: Page, email: string, password: string) {
  await p.goto(`${base}/signin`);
  await ready(p);
  await p.fill('[name="email"]', email);
  await p.fill('[name="password"]', password);
  await p.click('main button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
}
const photoFile = join(tmpdir(), `e2e-photo-${tag}.jpg`);
const fakeFile = join(tmpdir(), `e2e-fake-${tag}.jpg`);
const uploaded: string[] = [];

try {
  const owner = await newPage();
  await signInUI(owner, mail("a"), PW);

  // 1. Dashboard overview.
  await owner.goto(`${base}/dashboard`);
  await owner.locator("main h1").waitFor();
  const overview = await mainText(owner);
  check("dashboard shows the store and its status help", overview.includes(`Dash a ${tag}`) && overview.includes("approved and visible to families"));
  check("owner sees Profile and Reps sections", (await owner.locator('main nav a[href$="/dashboard/profile"]').count()) === 1 && (await owner.locator('main nav a[href$="/dashboard/reps"]').count()) === 1);

  // 2. Profile edit + server-side validation.
  await owner.goto(`${base}/dashboard/profile`);
  await ready(owner);
  const detailsForm = owner.locator("form", { has: owner.locator('[name="storeName"]') });
  await detailsForm.locator('[name="website"]').fill("http://insecure.example");
  await detailsForm.evaluate((f) => f.setAttribute("novalidate", ""));
  await detailsForm.locator('button[type="submit"]').click();
  await owner.locator("main [role=alert]").first().waitFor();
  check("non-https website rejected by the server, nothing saved", (await mainText(owner)).includes("https://") && !(await Store.findById(A.storeId).lean())?.contact?.website);
  await ready(owner);
  const df = owner.locator("form", { has: owner.locator('[name="storeName"]') });
  await df.locator('[name="website"]').fill("https://dash-a.example");
  await df.locator('[name="description"]').fill("Toys and games for all ages.\nOpen 7 days.");
  await df.locator('[name="city"]').fill("Alta");
  await df.locator('button[type="submit"]').click();
  await owner.locator("main").getByText("Saved.").waitFor();
  const a1 = await Store.findById(A.storeId).lean();
  check("profile saved (website, multi-line description, city)", a1?.contact?.website === "https://dash-a.example" && a1.contact?.address?.city === "Alta" && a1.description === "Toys and games for all ages.\nOpen 7 days.");
  check("profile change audited", !!(await AuditLog.exists({ targetId: a1?._id, action: "store.profile_update" })));

  // 3. Photos: real upload (with fake GPS/EXIF), fake image rejected, remove.
  writeFileSync(photoFile, await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#1f6f43" } }).withExif({ IFD0: { ImageDescription: "secret-location" } }).jpeg().toBuffer());
  writeFileSync(fakeFile, "<html>not an image</html>");
  await ready(owner);
  await owner.setInputFiles('[name="photo"]', fakeFile);
  await owner.locator("form", { has: owner.locator('[name="photo"]') }).locator('button[type="submit"]').click();
  await owner.locator("main [role=alert]").first().waitFor();
  check("a fake 'jpg' (HTML) is rejected", (await mainText(owner)).includes("JPEG, PNG or WebP") && ((await Store.findById(A.storeId).lean())?.photos?.length ?? 0) === 0);
  await ready(owner);
  await owner.setInputFiles('[name="photo"]', photoFile);
  await owner.locator("form", { has: owner.locator('[name="photo"]') }).locator('button[type="submit"]').click();
  await owner.locator('main img[alt="Store photo 1"]').waitFor({ timeout: 30_000 });
  const a2 = await Store.findById(A.storeId).lean();
  const photo = a2?.photos?.[0];
  if (photo) uploaded.push(photo.pathname);
  check("photo uploaded and shown", !!photo && photo.pathname.startsWith(`stores/${A.storeId}/`));
  const served = photo ? await fetch(photo.url) : null;
  const meta = served ? await sharp(Buffer.from(await served.arrayBuffer())).metadata() : null;
  check("stored photo is WebP, resized, with location/EXIF stripped", meta?.format === "webp" && (meta.width ?? 0) <= 1600 && !meta.exif, `${meta?.format} ${meta?.width} exif=${!!meta?.exif}`);

  // 4. IDOR: owner B tries to remove owner A's photo by editing the hidden field.
  const ownerB = await newPage();
  await signInUI(ownerB, mail("b"), PW);
  await Store.updateOne({ _id: B.storeId }, { $push: { photos: { url: `https://${blobPublicHost(process.env.BLOB_STORE_ID)}/stores/${B.storeId}/123e4567-e89b-42d3-a456-426614174000.webp`, pathname: `stores/${B.storeId}/123e4567-e89b-42d3-a456-426614174000.webp` } } });
  await ownerB.goto(`${base}/dashboard/profile`);
  await ready(ownerB);
  await ownerB.locator('input[name="pathname"]').first().evaluate((el, v) => ((el as HTMLInputElement).value = v), photo?.pathname ?? "");
  await ownerB.locator("form", { has: ownerB.locator('input[name="pathname"]') }).first().locator('button[type="submit"]').click();
  await ownerB.waitForTimeout(1500);
  check("another store's owner can't delete this store's photo", ((await Store.findById(A.storeId).lean())?.photos?.length ?? 0) === 1);
  await Store.updateOne({ _id: B.storeId }, { $set: { photos: [] } });

  // Owner A removes the photo.
  await owner.goto(`${base}/dashboard/profile`);
  await ready(owner);
  await owner.locator("form", { has: owner.locator('input[name="pathname"]') }).first().locator('button[type="submit"]').click();
  await owner.locator("main").getByText("No photos yet").waitFor();
  check("owner removes the photo (DB updated)", ((await Store.findById(A.storeId).lean())?.photos?.length ?? 0) === 0);
  uploaded.length = 0; // removed by the app itself

  if (PROD) {
    // Invite still goes out (to Resend's test inbox); acceptance needs the emailed link, so stop here.
    await owner.goto(`${base}/dashboard/reps`);
    await ready(owner);
    await owner.fill('[name="email"]', repEmail);
    await owner.click('main form button[type="submit"]');
    await owner.locator("main").getByText("Invitation sent.").waitFor();
    check("rep invitation sent (production)", (await mainText(owner)).includes(repEmail));
  }
  if (!PROD) {
  // 5. Reps: invite → accept → limited view.
  await owner.goto(`${base}/dashboard/reps`);
  await ready(owner);
  await owner.fill('[name="email"]', repEmail);
  await owner.click('main form button[type="submit"]');
  await owner.locator("main").getByText("Invitation sent.").waitFor();
  check("pending invitation listed", (await mainText(owner)).includes(repEmail));
  const repLink = await emailedLink(repEmail, "inviteRep", "/accept-rep-invite");
  check("rep invite email has an /accept-rep-invite link", !!repLink);
  const rep = await newPage();
  await rep.goto(repLink!);
  await rep.locator("main").getByText(`Dash a ${tag}`).waitFor();
  await ready(rep);
  await rep.fill('[name="name"]', "Rep One");
  await rep.fill('[name="password"]', PW);
  await rep.click('main button[type="submit"]');
  await rep.locator("main [role=status]").waitFor({ timeout: 20_000 });
  const repUser = await User.findOne({ email: repEmail }).lean();
  check("rep account created, active, linked to the store", repUser?.role === "store_rep" && repUser.status === "active" && String(repUser.storeId) === A.storeId && ((await Store.findById(A.storeId).lean())?.repUserIds ?? []).map(String).includes(String(repUser?._id)));
  await signInUI(rep, repEmail, PW);
  await rep.goto(`${base}/dashboard`);
  await rep.locator("main h1").waitFor();
  check("rep sees the dashboard as a rep, without Profile/Reps", (await mainText(rep)).includes("(rep)") && (await rep.locator('main nav a[href$="/dashboard/reps"]').count()) === 0);
  await rep.goto(`${base}/dashboard/profile`);
  await rep.locator("main [role=alert]").waitFor();
  check("rep can't open the owner-only profile page", (await mainText(rep)).includes("isn't connected") || (await rep.locator('[name="storeName"]').count()) === 0);

  // 6. Owner removes the rep: access ends immediately (membership checked in the DB).
  await owner.goto(`${base}/dashboard/reps`);
  await owner.locator("main").getByText("Rep One").waitFor();
  await owner.locator("li", { hasText: "Rep One" }).locator('button[type="submit"]').click();
  await owner.locator("main").getByText("No reps yet.").waitFor();
  const removed = await User.findOne({ email: repEmail }).lean();
  check("removed rep: suspended, unlinked, sessions revoked", removed?.status === "suspended" && !removed.storeId && (removed.sessionVersion ?? 0) >= 1);
  await rep.goto(`${base}/dashboard`);
  await rep.waitForTimeout(1000);
  check("removed rep immediately loses dashboard access", !(await rep.locator("main").innerText()).includes(`Dash a ${tag}`));
  check("removal audited", !!(await AuditLog.exists({ action: "rep.remove", targetId: removed?._id })));

  // 7. Re-invite the removed rep: reactivated on acceptance.
  await owner.fill('[name="email"]', repEmail);
  await ready(owner);
  await owner.click('main form:has([name="email"]) button[type="submit"]');
  await owner.locator("main").getByText("Invitation sent.").waitFor();
  const link2 = await emailedLink(repEmail, "inviteRep", "/accept-rep-invite", repLink!);
  const rep2 = await newPage();
  await rep2.goto(link2!);
  await ready(rep2);
  await rep2.fill('[name="name"]', "Rep One Again");
  await rep2.fill('[name="password"]', `${PW} 2`);
  await rep2.click('main button[type="submit"]');
  await rep2.locator("main [role=status]").waitFor({ timeout: 20_000 });
  const back = await User.findOne({ email: repEmail }).lean();
  check("re-invited rep is re-activated (same account)", back?.status === "active" && String(back._id) === String(removed?._id) && String(back.storeId) === A.storeId);

  }

  // 8. Suspended store: profile is read-only.
  const ownerS = await newPage();
  await signInUI(ownerS, mail("s"), PW);
  await ownerS.goto(`${base}/dashboard/profile`);
  await ownerS.locator("main h1").waitFor();
  check("suspended store: profile read-only (fields disabled, explanation shown)",
    (await ownerS.locator('[name="storeName"]').isDisabled()) && (await mainText(ownerS)).includes("can't be edited"));

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  for (const p of uploaded) await deletePublicImage(p, { folder: "stores", ownerId: A.storeId }).catch(() => {});
  const users = await User.find({ email: trusted({ $regex: new RegExp(`(-${tag}@spiritofsanta\\.test|${tag}@resend\\.dev)$`) }) }).select("_id").lean();
  const ids = [A.storeId, B.storeId, S.storeId];
  await AuditLog.collection.deleteMany({ $or: [{ targetId: { $in: ids.map((i) => new mongoose.Types.ObjectId(i)) } }, { actorUserId: { $in: users.map((u) => u._id) } }] });
  await Store.collection.deleteMany({ _id: { $in: ids.map((i) => new mongoose.Types.ObjectId(i)) } });
  await User.collection.deleteMany({ _id: { $in: users.map((u) => u._id) } });
  await ActionToken.collection.deleteMany({ email: { $regex: new RegExp(`(-${tag}@spiritofsanta\\.test|${tag}@resend\\.dev)$`) } });
  await mongoose.disconnect();
}
process.exit(report());
