/**
 * The public address of THIS app, for page metadata (link previews / share images need absolute URLs:
 * Facebook, iMessage etc. can't follow "/opengraph-image").
 *
 * Order: the app's own *_APP_URL variable (exact address, e.g. https://www.spiritofsanta.com) → on Vercel production,
 * the project's production domain (VERCEL_PROJECT_PRODUCTION_URL, set by Vercel automatically) → on a Vercel preview,
 * the branch address (VERCEL_BRANCH_URL: stable per branch, unlike VERCEL_URL which changes every deploy and would
 * defeat the build cache) → localhost in development.
 *
 * Unlike the email-link helpers in @repo/stores/urls, this NEVER throws: a wrong preview link is harmless, a page that
 * fails to render is not.
 */
export function metadataOrigin(envName: "FAMILY_APP_URL" | "STORE_APP_URL", devPort: number): URL {
  const own = process.env[envName];
  if (own && URL.canParse(own)) return new URL(new URL(own).origin);
  const vercel =
    process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_BRANCH_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL(`http://localhost:${devPort}`);
}
