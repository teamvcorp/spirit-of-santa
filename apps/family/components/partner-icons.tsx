/**
 * Small badges for the public partners page (owner 2026-11-18). Original drawings (inline SVG, theme-independent
 * colours so they read on the light logo tile):
 *  - NorthStar: a store that gave Christmas Magic this season.
 *  - GrumpyFace: a company that declined our invitation. A generic grumpy green face of our own, NOT the Dr. Seuss
 *    Grinch (that character's look is copyrighted).
 * Decorative: the tile always says the same thing in words (aria-label / visible text), so these are aria-hidden.
 */
export function NorthStar({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      {/* Long north–south points, short east–west: the classic "North Star" shape. */}
      <path d="M12 0 L13.6 10.4 L20 12 L13.6 13.6 L12 24 L10.4 13.6 L4 12 L10.4 10.4 Z" fill="var(--color-gold)" stroke="var(--color-night)" strokeWidth="0.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1.6" fill="#fff7d6" />
    </svg>
  );
}

export function GrumpyFace({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="11" fill="#6aa84f" stroke="#2f5d1f" strokeWidth="1" />
      {/* Frowning brows, small eyes and a sulky mouth. */}
      <path d="M6.5 8.2 L10 9.6 M17.5 8.2 L14 9.6" stroke="#1f3d14" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="9" cy="11.2" r="1.1" fill="#1f3d14" />
      <circle cx="15" cy="11.2" r="1.1" fill="#1f3d14" />
      <path d="M8 17.2 Q12 14.2 16 17.2" fill="none" stroke="#1f3d14" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
