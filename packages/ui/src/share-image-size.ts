/**
 * Link-preview image size (1.91:1, what every platform expects). Its own import-free module on purpose: the layouts
 * need only this number, and importing it from share-image.tsx would pull next/og and ~185 KB of logo data into
 * every page's server bundle (slower cold starts). Review of 19def00.
 */
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };
