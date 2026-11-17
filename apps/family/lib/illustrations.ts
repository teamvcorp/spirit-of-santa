/**
 * The ONE list of illustration files (Phase 8.5). Files live in apps/family/public/illustrations
 * (how to replace them: docs/illustrations.md): replace a file, keep its name, and every page that uses it updates.
 * The home hero is no longer a file: it's drawn in code so the theme can recolour it (components/hero-scene.tsx).
 */
export const ILLUSTRATIONS = {
  giftBox: "/illustrations/gift-box.svg",
  /** "Find the elf" game (2026-11-16, components/hidden-elf.tsx): owner-supplied picture, trimmed to 250x360 WebP. */
  elf: "/illustrations/elf.webp",
} as const;
