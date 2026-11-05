/**
 * Shared helpers for E2E scripts (scripts/e2e/*.ts). No test framework: plain fetch.
 */

/** Collect results; print with report(). */
export function makeChecks() {
  const results: string[] = [];
  const check = (name: string, ok: boolean, extra = "") =>
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  const report = () => {
    console.log(results.join("\n"));
    return results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
  };
  return { results, check, report };
}

const decode = (v: string) =>
  v.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * GET a page, fill its Server Action form like a browser WITHOUT JavaScript, POST it and
 * return the response HTML. React renders hidden `$ACTION_*` inputs into server-action forms
 * for exactly this (progressive enhancement); we send those plus our fields.
 */
export async function submitForm(
  base: string,
  path: string,
  fields: Record<string, string>,
  opts: { formIndex?: number; cookie?: string } = {},
): Promise<{ status: number; html: string }> {
  const headers: Record<string, string> = opts.cookie ? { cookie: opts.cookie } : {};
  const page = await (await fetch(base + path, { headers })).text();
  const forms = [...page.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]).filter((f) => f.includes("$ACTION"));
  const form = forms[opts.formIndex ?? 0];
  if (!form) throw new Error(`no server-action form on ${path}`);
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*>/g)) {
    const tag = m[0];
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    if (name && (name.startsWith("$ACTION") || /type="hidden"/.test(tag))) {
      fd.append(name, decode(/value="([^"]*)"/.exec(tag)?.[1] ?? ""));
    }
  }
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  // Browsers always send Origin on form posts; Next checks it against the host (CSRF guard).
  const res = await fetch(base + path, { method: "POST", body: fd, headers: { ...headers, origin: new URL(base).origin } });
  return { status: res.status, html: await res.text() };
}

/**
 * True if `text` is VISIBLY shown inside an alert/status box. (next-intl embeds every message
 * in the page's JSON for client components, so html.includes(text) would always match.)
 */
export function shown(html: string, text: string): boolean {
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "(?:'|&#x27;|’)");
  return new RegExp(`role="(?:alert|status)"[^>]*>(?:(?!</div>)[\\s\\S])*?${esc}`).test(html);
}

/** Sign in with credentials through next-auth's endpoints; returns the session user or null. */
export async function signIn(base: string, email: string, password: string) {
  const cookies = new Map<string, string>();
  const take = (r: Response) =>
    r.headers.getSetCookie().forEach((c) => {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      cookies.set(pair!.slice(0, i), pair!.slice(i + 1));
    });
  const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  take(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
  });
  take(res);
  const s = (await (await fetch(`${base}/api/auth/session`, { headers: { cookie: cookie() } })).json()) as {
    user?: { id?: string; role?: string; storeId?: string; email?: string };
  };
  return s.user ? { ...s.user, cookie: cookie() } : null;
}
