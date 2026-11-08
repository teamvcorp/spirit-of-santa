/**
 * The home hero's cottage scene (approved mockup, 2026-11-08): moon, hills, snow-capped trees, a house with roof
 * lights, chimney smoke, glowing windows and a wreath. Original art, word-free, decorative (aria-hidden).
 *
 * Themeable: the colours that differ between Winter Magic and Festive come from CSS variables (app/themes.css).
 * SVG presentation attributes (fill="…") can't read CSS variables, so those parts use style={{ fill: "var(--t-…)" }}.
 * Animations are the sos-* classes in app/magic.css and all stop for reduced motion.
 * The hills and snow run far past the drawing (x -2000…3200, overflow visible) so the ground always reaches the screen
 * edges, however wide; the hero section clips the rest.
 * Server component: no JavaScript is sent for it. Rendered once per page, so its gradient ids are unique.
 */
const GOLD = "var(--t-gold)";
const fill = (v: string) => ({ fill: `var(${v})` });

export function HeroScene() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 1200 430" preserveAspectRatio="xMidYMax meet" className="block h-auto w-full overflow-visible">
      <defs>
        <radialGradient id="sos-moon-glow">
          <stop offset="0" stopColor="#FFF4D6" stopOpacity=".45" />
          <stop offset="1" stopColor="#FFF4D6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sos-window-glow">
          <stop offset="0" stopColor="#FFD66B" stopOpacity=".9" />
          <stop offset=".45" stopColor="#FFB547" stopOpacity=".35" />
          <stop offset="1" stopColor="#FFB547" stopOpacity="0" />
        </radialGradient>
        <mask id="sos-crescent">
          <rect width="1200" height="430" fill="#fff" />
          <circle cx="1012" cy="62" r="36" fill="#000" />
        </mask>
      </defs>
      {/* moon */}
      <circle cx="990" cy="80" r="110" fill="url(#sos-moon-glow)" />
      <circle cx="990" cy="80" r="42" fill="#FFF4D6" mask="url(#sos-crescent)" />
      {/* far hills + distant trees */}
      <path d="M-2000 300 L0 300 C 180 230, 360 260, 520 285 S 860 220, 1200 270 L3200 270 L3200 430 L-2000 430 Z" style={fill("--t-hills")} />
      <g style={fill("--t-far-trees")}>
        <polygon points="90,300 110,250 130,300" />
        <polygon points="125,296 142,258 159,296" />
        <polygon points="1040,285 1062,232 1084,285" />
        <polygon points="1078,288 1094,250 1110,288" />
      </g>
      {/* snow ground */}
      <path d="M-2000 340 L0 340 C 220 300, 420 320, 600 330 S 960 300, 1200 330 L3200 330 L3200 430 L-2000 430 Z" fill="#DCE6F5" />
      <path d="M-2000 372 L0 372 C 260 350, 520 368, 760 362 S 1060 350, 1200 366 L3200 366 L3200 430 L-2000 430 Z" fill="#F4F8FF" />
      <ellipse className="sos-glow" cx="600" cy="352" rx="170" ry="26" fill="url(#sos-window-glow)" opacity=".7" />
      {/* house */}
      <g>
        <rect x="660" y="150" width="34" height="70" style={fill("--t-roof")} />
        <rect x="654" y="144" width="46" height="12" rx="3" fill="#F4F8FF" />
        <circle className="sos-smoke" cx="677" cy="128" r="10" fill="#C9D4EA" />
        <circle className="sos-smoke" cx="677" cy="128" r="10" fill="#C9D4EA" style={{ animationDelay: "2s" }} />
        <circle className="sos-smoke" cx="677" cy="128" r="10" fill="#C9D4EA" style={{ animationDelay: "4s" }} />
        <rect x="470" y="232" width="260" height="122" style={fill("--t-house")} />
        <polygon points="446,240 600,140 754,240" style={fill("--t-roof")} />
        <path d="M440 244 L600 134 L760 244 L748 252 L600 150 L452 252 Z" fill="#F4F8FF" />
        {/* string lights along the roof */}
        <g>
          {(
            [
              [476, 236, "#FF5A5F", "0s"],
              [508, 214, GOLD, ".6s"],
              [540, 192, "#58D6AA", "1.2s"],
              [572, 170, "#7FB2FF", "1.8s"],
              [628, 170, "#FF5A5F", ".3s"],
              [660, 192, GOLD, ".9s"],
              [692, 214, "#58D6AA", "1.5s"],
              [724, 236, "#7FB2FF", "2.1s"],
            ] as const
          ).map(([cx, cy, color, delay]) => (
            <circle key={cx} className="sos-twinkle" cx={cx} cy={cy} r="4.5" style={{ fill: color, animationDelay: delay }} />
          ))}
        </g>
        {/* glowing windows */}
        <circle className="sos-glow" cx="527" cy="284" r="62" fill="url(#sos-window-glow)" />
        <circle className="sos-glow" cx="673" cy="284" r="62" fill="url(#sos-window-glow)" style={{ animationDelay: "1.3s" }} />
        <rect x="502" y="260" width="50" height="46" rx="4" fill="#FFD66B" />
        <rect x="648" y="260" width="50" height="46" rx="4" fill="#FFD66B" />
        <path d="M527 260 V306 M502 283 H552 M673 260 V306 M648 283 H698" strokeWidth="4" style={{ stroke: "var(--t-house)" }} />
        {/* door with wreath */}
        <rect x="578" y="276" width="44" height="78" rx="22" style={fill("--t-door")} />
        <circle cx="600" cy="300" r="12" fill="none" stroke="#2E8B57" strokeWidth="5" />
        <circle cx="600" cy="312" r="3" fill="#FF5A5F" />
        <circle cx="613" cy="322" r="2.5" style={{ fill: GOLD }} />
        <path d="M462 354 C 520 344, 680 344, 738 354 Z" fill="#F4F8FF" />
      </g>
      {/* evergreens with snow caps (and a gold star on the tall one) */}
      <g>
        <polygon points="330,360 370,250 410,360" fill="#1F5C46" />
        <polygon points="345,300 370,236 395,300" fill="#24694F" />
        <path d="M355 278 L370 236 L385 278 L376 272 L370 280 L364 272 Z" fill="#F4F8FF" />
        <polygon points="404,364 430,292 456,364" fill="#1F5C46" />
        <path d="M420 318 L430 292 L440 318 L434 314 L430 320 L426 314 Z" fill="#F4F8FF" />
        <polygon points="800,362 846,240 892,362" fill="#1F5C46" />
        <polygon points="817,296 846,224 875,296" fill="#24694F" />
        <path d="M829 268 L846 224 L863 268 L853 262 L846 270 L839 262 Z" fill="#F4F8FF" />
        <polygon points="846,224 849,214 846,206 843,214" style={{ fill: GOLD }} />
      </g>
    </svg>
  );
}

/** Twinkling stars across the sky (decorative). Fixed positions, so server and browser render the same. */
const STARS: [string, string, string][] = [
  ["9%", "8%", "0s"], ["16%", "22%", ".8s"], ["6%", "37%", "1.6s"], ["21%", "48%", ".3s"], ["11%", "61%", "2.1s"],
  ["27%", "88%", "1.1s"], ["4%", "93%", "2.6s"], ["33%", "4%", "1.9s"], ["38%", "70%", ".5s"], ["14%", "79%", "1.4s"],
];
export function Stars() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {STARS.map(([top, left, delay]) => (
        <span key={top + left} className="sos-star" style={{ top, left, animationDelay: delay }} />
      ))}
    </div>
  );
}

/** Falling snow layers (magic.css). `layers` picks which depths to draw; "near" goes in FRONT of the scene. */
export function Snow({ layers }: { layers: ("far" | "mid" | "near")[] }) {
  return (
    <>
      {layers.map((l) => (
        <div key={l} aria-hidden="true" className={`sos-snow sos-snow-${l}`} style={l === "near" ? { zIndex: 4 } : undefined} />
      ))}
    </>
  );
}
