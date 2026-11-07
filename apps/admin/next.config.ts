import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { blobImagesConfig } from "@repo/storage/image-rules";
import { nextSecurityHeaders } from "@repo/lib/security-headers";

// Connects next-intl to ./i18n/request.ts (locale + messages per request).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // CSP, HSTS and friends on every response (Phase 8). Why + Stripe origins: docs/vendor/security-headers.md
  headers: () => nextSecurityHeaders(),
  // next/image may only load photos from our own public Blob store (see image-rules.ts).
  images: blobImagesConfig(process.env.BLOB_STORE_ID),
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
