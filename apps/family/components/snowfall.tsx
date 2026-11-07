/**
 * Falling snow behind the home page hero (Phase 8.5: snow on the HOME page only, owner's choice).
 * Server component, pure CSS (no JavaScript running in the browser): flakes have FIXED pseudo-random
 * positions so the server and browser render the same markup. Decorative only: aria-hidden, hidden
 * entirely for reduced motion (magic.css).
 */
const FLAKES = Array.from({ length: 40 }, (_, i) => {
  const r = (k: number) => (((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1) + 1) % 1;
  return {
    left: `${(r(2) * 100).toFixed(2)}%`,
    size: `${2 + Math.round(r(1) * 4)}px`,
    opacity: Number((0.45 + r(3) * 0.5).toFixed(2)),
    duration: `${(7 + r(4) * 9).toFixed(1)}s`,
    delay: `${(-r(5) * 16).toFixed(1)}s`,
  };
});

export function Snowfall() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {FLAKES.map((f, i) => (
        <span key={i} className="sos-flake" style={{ left: f.left, width: f.size, height: f.size, opacity: f.opacity, animationDuration: f.duration, animationDelay: f.delay }} />
      ))}
    </div>
  );
}
