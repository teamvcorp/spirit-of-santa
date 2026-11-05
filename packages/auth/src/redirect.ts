/**
 * Where to send the user after sign-in. Client-safe and unit-tested.
 *
 * `?callbackUrl=` comes from the URL, so an attacker can craft a sign-in link like
 *   /signin?callbackUrl=https://evil.example/fake-login
 * ("open redirect": the user trusts our page, signs in, and lands on a phishing site).
 * We only ever return a path on OUR site; everything else falls back to "/".
 */
const MAX_LENGTH = 2000;
const PROBE_ORIGIN = "http://sos.invalid";

/**
 * True if a browser would treat `path` as pointing at ANOTHER host: "//evil.com" and
 * "/\evil.com" are protocol-relative URLs, not paths.
 */
const looksLikeOtherHost = (path: string) => path.startsWith("//") || path.startsWith("/\\");

export function safeCallbackPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || raw.length > MAX_LENGTH) return fallback;
  // Must be a plain absolute path: rejects full URLs, "javascript:", protocol-relative
  // URLs and anything with control characters.
  // eslint-disable-next-line no-control-regex
  if (!raw.startsWith("/") || looksLikeOtherHost(raw) || /[\u0000-\u001f\u007f]/.test(raw)) {
    return fallback;
  }
  try {
    const url = new URL(raw, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback; // resolved to another host
    // Validate what we RETURN, not just what came in: URL parsing removes dot segments,
    // so "/.//evil.com" or "/a/..//evil.com" pass the raw checks above but normalise to
    // "//evil.com". (Found in review; covered by tests.)
    const out = url.pathname + url.search + url.hash;
    if (looksLikeOtherHost(out)) return fallback;
    // Never bounce back into the auth endpoints or the sign-in page itself (loops).
    if (url.pathname.startsWith("/api/") || /^\/(?:[a-z]{2}\/)?signin(?:\/|$)/.test(url.pathname)) {
      return fallback;
    }
    return out;
  } catch {
    return fallback;
  }
}
