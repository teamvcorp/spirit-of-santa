// Role pinning per app against a RUNNING app:
//   node scripts/e2e/roles.mjs http://localhost:3001 <pwFile> dev-owner@spiritofsanta.test,dev-rep@spiritofsanta.test dev-parent@spiritofsanta.test,dev-admin@spiritofsanta.test '*'
import { readFileSync } from "node:fs";
const [base, pwFile, allowed, denied, role] = process.argv.slice(2);
const password = readFileSync(pwFile, "utf8").trim();
const out = [];
async function tryLogin(email) {
  const c = await fetch(`${base}/api/auth/csrf`);
  const cookie = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const { csrfToken } = await c.json();
  const r = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
  });
  const set = r.headers.getSetCookie().map((x) => x.split(";")[0]);
  const session = set.find((x) => /session-token=./.test(x));
  if (!session) return null;
  return (await (await fetch(`${base}/api/auth/session`, { headers: { cookie: [cookie, session].join("; ") } })).json()).user;
}
for (const e of allowed.split(",")) {
  const u = await tryLogin(e);
  out.push(`${u && (u.role === role || role === "*") ? "PASS" : "FAIL"}  ${e} allowed  role=${u?.role} store=${!!u?.storeId}`);
}
for (const e of denied.split(",")) {
  const u = await tryLogin(e);
  out.push(`${!u ? "PASS" : "FAIL"}  ${e} denied`);
}
const page = await (await fetch(`${base}/signin`)).text();
out.push(`${/type="password"/.test(page) ? "PASS" : "FAIL"}  /signin renders`);
console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
