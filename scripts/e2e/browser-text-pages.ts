/**
 * Real-browser E2E (Edge) for Phase 5 slice 4a: the pages REGISTERED with the carriers for
 * pay-later texts (Toll-Free Verification, docs/vendor/twilio.md): /text-messages, /terms, /privacy.
 * Checks the consent wording is EXACTLY the registered sentence, the box is never pre-ticked, the
 * required SMS statements are present, and every page links Privacy + Terms. No database needed.
 *
 *   node scripts/e2e/browser-text-pages.ts http://localhost:3000
 */
import { chromium, type Page } from "playwright-core";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-text-pages.ts <familyUrl>");
const { check, report } = makeChecks();
// The sentence registered with the carriers (docs/vendor/twilio.md). Must match the page exactly.
const REGISTERED = "Text me a link to pay this tip later. Spirit of Santa will send 1 text with a secure payment link that expires in 7 days. No marketing. Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const open = async (p: Page, url: string) => {
  const res = await p.goto(url);
  await p.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  return { status: res?.status() ?? 0, text: await p.locator("main:visible").innerText() };
};
const linksTo = async (p: Page, scope: string, path: string) => (await p.locator(`${scope} a[href$="${path}"]`).count()) > 0;

try {
  // 1. /text-messages: public, the form with the exact wording, unticked, nothing can be sent.
  const tm = await open(page, `${base}/text-messages`);
  check("/text-messages is public (200)", tm.status === 200);
  check("explains one message per request, no marketing, STOP/HELP, rates",
    tm.text.includes("Exactly one text message") && tm.text.includes("never send marketing") && tm.text.includes("Reply STOP") && tm.text.includes("rates may apply"));
  const consent = (await page.locator('main:visible input[name="consent"] + span').innerText()).replace(/\s+/g, " ");
  check("consent wording is EXACTLY the registered sentence", consent.startsWith(REGISTERED), consent);
  check("consent box is NOT pre-ticked", !(await page.locator('main:visible input[name="consent"]').isChecked()));
  check("preview can't send (button disabled)", await page.locator("main:visible form button[type=submit]").isDisabled());
  check("consent text links Privacy + Terms", (await linksTo(page, "main:visible form", "/privacy")) && (await linksTo(page, "main:visible form", "/terms")));
  check("states numbers are never shared for marketing", tm.text.includes("never shared with third parties or affiliates for marketing"));

  // 2. /terms: public, has the SMS terms.
  const terms = await open(page, `${base}/terms`);
  check("/terms is public (200) with SMS terms", terms.status === 200 && terms.text.includes("Text messages (pay later)") && terms.text.includes("Carriers are not liable") && terms.text.includes("expires after 7 days"));
  check("/terms shows the points rate from the server constant ($1.50) and the dispute exception", terms.text.includes("currently $1.50 = 1 point") && terms.text.includes("card network requires it"));

  // 3. /privacy: the carrier-required sentence.
  const pv = await open(page, `${base}/privacy`);
  check("/privacy is titled 'Privacy Policy…' and names the texting provider", pv.text.includes("Privacy Policy and Children's Privacy Notice") && pv.text.includes("Twilio"));
  check("/privacy has a Text messages section with the no-sharing sentence",
    pv.status === 200 && pv.text.includes("Text messages") && pv.text.includes("not shared with third parties or affiliates for marketing or promotional purposes"));

  // 4. Footer links all three on several kinds of pages.
  let footerOk = true;
  for (const path of ["/", "/donate", "/signin", "/terms"]) {
    await open(page, `${base}${path}`);
    footerOk &&= (await linksTo(page, "footer", "/privacy")) && (await linksTo(page, "footer", "/terms")) && (await linksTo(page, "footer", "/text-messages"));
  }
  check("footer links Privacy, Terms and Text messages (home, donate, sign-in, terms)", footerOk);

  // 5. Spanish.
  const es = await (await browser.newContext()).newPage();
  es.on("pageerror", (e) => errors.push(e.message));
  const esTm = await open(es, `${base}/es/text-messages`);
  check("Spanish /es/text-messages", esTm.status === 200 && esTm.text.includes("Mensajes de texto de Spirit of Santa") && esTm.text.includes("Responde STOP"));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
}
process.exit(report());
