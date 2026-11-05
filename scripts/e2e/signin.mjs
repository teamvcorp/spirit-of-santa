// End-to-end sign-in check against a RUNNING app (dev DB + seeded users; see docs/CODEMAP.md).
//   1) npm run seed:dev  2) build + start the app  3) put SEED_PASSWORD in a file outside the repo
//   node scripts/e2e/signin.mjs http://localhost:3000 <path-to-password-file>
// Checks: session, role, wrong password/unknown email (same generic error), cross-app rejection,
// pre-JS form safety, noindex, Spanish page, sign-out, error-flow landing, hostile callbackUrl.
import { readFileSync } from "node:fs";

const base = process.argv[2];
const password = readFileSync(process.argv[3], "utf8").trim();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);

function jar() {
  const cookies = new Map();
  return {
    take(res) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        cookies.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    names: () => [...cookies.keys()],
    has: (re) => [...cookies.keys()].some((k) => re.test(k) && cookies.get(k)),
  };
}

async function signIn(email, pw) {
  const j = jar();
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  j.take(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: j.header() },
    body: new URLSearchParams({ csrfToken, email, password: pw, json: "true" }),
  });
  j.take(res);
  const body = await res.json().catch(() => ({}));
  return { j, res, location: res.headers.get("location") ?? body.url ?? "" };
}

async function session(j) {
  const r = await fetch(`${base}/api/auth/session`, { headers: { cookie: j.header() } });
  return r.json();
}

// 1. Correct parent credentials on the family app
const ok = await signIn("dev-parent@spiritofsanta.test", password);
check("parent sign-in sets a session cookie", ok.j.has(/session-token$/), `cookies=${ok.j.names().join(",")}`);
const s = await session(ok.j);
check("session has role=parent and a familyId", s?.user?.role === "parent" && !!s?.user?.familyId, JSON.stringify({ role: s?.user?.role, hasFamily: !!s?.user?.familyId }));
check("session never exposes password/hash", !JSON.stringify(s).toLowerCase().includes("hash"));

// 2. Header shows the signed-in state on the home page
const home = await fetch(`${base}/`, { headers: { cookie: ok.j.header() } });
const homeHtml = await home.text();
check("home page shows 'Signed in as' for the session", homeHtml.includes("Signed in as") && homeHtml.includes("dev-parent@spiritofsanta.test"));

// 3. Wrong password → no session, generic error, redirected to our sign-in page
const bad = await signIn("dev-parent@spiritofsanta.test", password + "x");
check("wrong password gives no session", !bad.j.has(/session-token$/));
check("wrong password → generic CredentialsSignin only", /error=CredentialsSignin/.test(bad.location) && !/password|locked|exist/i.test(bad.location), bad.location);

// 4. Unknown email → identical outcome
const unknown = await signIn("nobody@spiritofsanta.test", password);
check("unknown email: same generic error as wrong password", unknown.location === bad.location, unknown.location);

// 5. Store user can't sign in to the family app (role pinned per app)
const wrongApp = await signIn("dev-owner@spiritofsanta.test", password);
check("store_owner rejected by family app", !wrongApp.j.has(/session-token$/), wrongApp.location);

// 6. Sign-in pages render in both languages
const en = await (await fetch(`${base}/signin`)).text();
const es = await (await fetch(`${base}/es/signin`)).text();
check("/signin form is in the server HTML (works before JS)", /type="password"/.test(en) && en.includes("Password"));
check("pre-JS form is method=post (password can't land in the URL)", /<form[^>]*method="post"/.test(en));
check("pre-JS submit button is disabled until hydration", /<button[^>]*type="submit"[^>]*disabled/.test(en));
check("/signin has noindex", en.includes('name="robots" content="noindex, nofollow"'));
check("/es/signin renders Spanish", es.includes("Contraseña") && es.includes('lang="es"'));

// 7. Sign out ends the session
const csrf2 = await (await fetch(`${base}/api/auth/csrf`, { headers: { cookie: ok.j.header() } })).json();
const out = await fetch(`${base}/api/auth/signout`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: ok.j.header() },
  body: new URLSearchParams({ csrfToken: csrf2.csrfToken, json: "true" }),
});
ok.j.take(out);
const after = await session(ok.j);
check("sign-out clears the session", !after?.user, JSON.stringify(after));

// 8. next-auth's error hop lands on OUR sign-in page
// (v4: /api/auth/error → /api/auth/signin → pages.signIn; follow both hops)
const hop1 = (await fetch(`${base}/api/auth/error?error=CredentialsSignin`, { redirect: "manual" })).headers.get("location") ?? "";
const hop2 = (await fetch(new URL(hop1, base), { redirect: "manual" })).headers.get("location") ?? "";
check("next-auth error flow ends on our /signin page", /^\/signin\?.*error=CredentialsSignin/.test(hop2), `${hop1} -> ${hop2}`);

// 9. A hostile callbackUrl never reaches the form (Next's router state echoes the page URL
//    as escaped JSON; that's expected and inert, so check the form's actual prop instead).
const evil = await (await fetch(`${base}/signin?callbackUrl=https%3A%2F%2Fevil.example&error=x`)).text();
check("form receives callbackUrl \"/\" for a hostile URL", evil.includes('\\"callbackUrl\\":\\"/\\"') && !evil.includes('\\"callbackUrl\\":\\"https'));
check("?error shows the generic message server-side", evil.includes("didn’t work"));

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
