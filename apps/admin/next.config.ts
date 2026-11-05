import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { blobImagesConfig } from "@repo/storage/image-rules";

// Connects next-intl to ./i18n/request.ts (locale + messages per request).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
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
