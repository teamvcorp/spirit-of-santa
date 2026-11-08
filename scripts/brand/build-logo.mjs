/**
 * Builds the logo files the apps use from the owner's designer files (new seal + badge, 2026-11-08).
 *
 *   sources (designer files, kept unchanged; replace one to update the logo):
 *     packages/ui/assets/source/badge-simple.svg     gift + bow, no lettering. Designer: "anything under 96 px".
 *     packages/ui/assets/source/seal-full-color.svg  "SPIRIT OF SANTA / NORTH POLE APPROVED / EST. 2012". 96 px and up.
 *     packages/ui/assets/source/seal-one-ink.svg     one colour, for rubber stamps / foil / embossing (print only).
 *   outputs:
 *     packages/ui/assets/logo-icon.svg   simple badge → header of all three apps (48–56 px), browser tab, phone icons
 *     packages/ui/assets/logo.svg        full-colour seal, lettering as outlines → link-preview picture (420 px)
 *     packages/ui/assets/print/seal-full-color.svg, seal-one-ink.svg   outlined, ready to send to a printer
 *     packages/ui/src/brand-art.generated.ts   logo + icon as data: URLs for the PNG renderers (icons, share image)
 *
 * Run after replacing a source:   npm run brand:logo
 *
 * WHY the lettering is converted to outlines (shapes) here:
 *  - The seals set their words in "Nunito Sans" 800 along curved paths (<textPath>). A phone without that font would
 *    draw them in a fallback font that doesn't fit the ring, and the server-side PNG renderer (next/og) has no fonts
 *    for text inside an SVG picture at all, so the words would vanish from the link preview.
 *  - The designer's own note says to outline the text before printing. Doing it in this script means it's repeatable.
 *  - Font: scripts/brand/fonts/nunito-sans-latin-800-normal.woff (Fontsource 5.2.7, SIL Open Font License, OFL.txt).
 *    Read with opentype.js (pinned dev dependency), only at build time: nothing is added to the websites.
 *
 * HOW (same rules a browser uses for <textPath startOffset="50%" text-anchor="middle">):
 *  each letter's advance = font width × size + letter-spacing (+ kerning); the line is centred on the middle of the
 *  arc; each letter is placed at its centre point along the arc and turned to follow it.
 * Only the shapes in these files are supported (circular arcs "M x y A r r 0 0 s x y" across the centre line, and
 * straight x/y text). Anything else stops the script with an error instead of drawing something wrong.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import opentype from "opentype.js";
import { optimize } from "svgo";

const ASSETS = new URL("../../packages/ui/assets/", import.meta.url);
const read = (name) => readFileSync(new URL(name, ASSETS), "utf8");
const fontBuf = readFileSync(new URL("fonts/nunito-sans-latin-800-normal.woff", import.meta.url));
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

const fail = (msg) => {
  throw new Error(`build-logo: ${msg}`);
};
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const r2 = (n) => Math.round(n * 100) / 100;

/** Letters of `text` with their advance (incl. spacing + kerning) and outline at the origin (baseline y = 0). */
function shapeLetters(text, size, spacing) {
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  return glyphs.map((g, i) => {
    const kern = i < glyphs.length - 1 ? font.getKerningValue(g, glyphs[i + 1]) * scale : 0;
    const width = g.advanceWidth * scale;
    if (g.index === 0) fail(`the font has no letter for "${text[i]}"`);
    return { width, advance: width + spacing + kern, path: g.getPath(-width / 2, 0, size).toPathData(3) };
  });
}

/** Total line length the way browsers measure it: every letter's advance, minus the spacing after the last one. */
const lineLength = (letters, spacing) => letters.reduce((s, l) => s + l.advance, 0) - spacing;

/** Circle arc from "M x0 y A r r 0 0 sweep x1 y" (both ends on the centre line, i.e. a half circle). */
function arcFrom(d) {
  const m = d.match(/^M\s*([\d.]+)\s+([\d.]+)\s*A\s*([\d.]+)\s+([\d.]+)\s+0\s+0\s+([01])\s+([\d.]+)\s+([\d.]+)$/);
  if (!m) fail(`unsupported text path "${d}"`);
  const [x0, y0, r, ry, sweep, x1, y1] = m.slice(1).map(Number);
  if (r !== ry || y0 !== y1 || Math.abs(x1 - x0 - 2 * r) > 1e-6) fail(`text path "${d}" is not a half circle`);
  const cx = (x0 + x1) / 2;
  // SVG y points down: sweep 1 goes from the left end OVER THE TOP (angle π → 2π), sweep 0 UNDER THE BOTTOM (π → 0).
  const dir = sweep === 1 ? 1 : -1;
  return {
    length: Math.PI * r,
    at(s) {
      const t = Math.PI + (dir * s) / r;
      // Point on the circle, and the direction of travel (the letters' baseline direction).
      return { x: cx + r * Math.cos(t), y: y0 + r * Math.sin(t), deg: (Math.atan2(dir * Math.cos(t), -dir * Math.sin(t)) * 180) / Math.PI };
    },
  };
}

/** Replace every <text> element with outlined <path>s (one <g> per text, keeping its fill). */
function outlineText(svg) {
  const arcs = {};
  for (const [, id, d] of svg.matchAll(/<path id="([^"]+)" d="([^"]+)"\s*\/>/g)) arcs[id] = arcFrom(d);
  let count = 0;
  const out = svg.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (_, attrs, inner) => {
    count++;
    const open = `<text${attrs}>`;
    if (attr(open, "font-weight") !== "800" || !attr(open, "font-family")?.startsWith("Nunito Sans"))
      fail("text is not Nunito Sans 800 (the only font this script carries)");
    if (attr(open, "text-anchor") !== "middle") fail('only text-anchor="middle" is supported');
    const size = Number(attr(open, "font-size"));
    const spacing = Number(attr(open, "letter-spacing") ?? 0);
    const fill = attr(open, "fill");
    const tp = inner.match(/^<textPath href="#([^"]+)" startOffset="50%">([^<]+)<\/textPath>$/);
    const content = tp ? tp[2] : inner;
    if (!tp && /</.test(inner)) fail(`unsupported text content "${inner}"`);
    const letters = shapeLetters(content, size, spacing);
    let pos;
    if (tp) {
      const arc = arcs[tp[1]] ?? fail(`text path #${tp[1]} not found`);
      let s = arc.length / 2 - lineLength(letters, spacing) / 2;
      pos = letters.map((l) => {
        const p = arc.at(s + l.width / 2);
        s += l.advance;
        return `translate(${r2(p.x)} ${r2(p.y)}) rotate(${r2(p.deg)})`;
      });
    } else {
      let x = Number(attr(open, "x")) - lineLength(letters, spacing) / 2;
      const y = Number(attr(open, "y"));
      pos = letters.map((l) => {
        const t = `translate(${r2(x + l.width / 2)} ${y})`;
        x += l.advance;
        return t;
      });
    }
    const paths = letters
      .map((l, i) => (l.path ? `<path transform="${pos[i]}" d="${l.path}"/>` : "")) // spaces have no outline
      .join("");
    return `<g${fill ? ` fill="${fill}"` : ""} aria-hidden="true">${paths}</g>`;
  });
  if (count === 0) fail("no <text> found: has the source file changed?");
  // The arc guides are no longer referenced once the words are shapes.
  return out.replace(/<path id="[^"]+" d="M[^"]+A[^"]+"\s*\/>/g, "");
}

const svgoConfig = {
  multipass: true,
  floatPrecision: 2,
  // Keep the viewBox (scaling) and the accessible name on the root (role="img" aria-label="…").
  plugins: [{ name: "preset-default" }, "removeDimensions"],
};
const shrink = (svg) => optimize(svg, svgoConfig).data + "\n";

const outputs = {
  "logo-icon.svg": shrink(read("source/badge-simple.svg")),
  "logo.svg": shrink(outlineText(read("source/seal-full-color.svg"))),
};
// Print copies: outlined, but otherwise unshrunk so a printer's software sees the designer's structure.
const print = {
  "print/seal-full-color.svg": outlineText(read("source/seal-full-color.svg")),
  "print/seal-one-ink.svg": outlineText(read("source/seal-one-ink.svg")),
};
for (const [name, svg] of Object.entries({ ...outputs, ...print })) {
  if (/<text\b|textPath/.test(svg)) fail(`${name} still has live text`);
  writeFileSync(new URL(name, ASSETS), svg);
  console.log(`${name}: ${svg.length} bytes (${gzipSync(svg, { level: 9 }).length} gzipped)`);
}

const dataUrl = (svg) => "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
writeFileSync(
  new URL("../../packages/ui/src/brand-art.generated.ts", import.meta.url),
  `// GENERATED by scripts/brand/build-logo.mjs (npm run brand:logo). Do not edit by hand.
// The logo artwork as data: URLs for the PNG renderers (app icons, share image). Server-side only:
// never import this into a Client Component (it would add the artwork to the browser bundle).
import "server-only";

/** Full-colour seal, lettering as outlines (share image, 96 px and up). */
export const LOGO_DATA_URL =
  ${JSON.stringify(dataUrl(outputs["logo.svg"]))};

/** Simple badge, gift only (tab + phone icons, under 96 px). */
export const LOGO_ICON_DATA_URL =
  ${JSON.stringify(dataUrl(outputs["logo-icon.svg"]))};
`,
);
console.log("wrote packages/ui/src/brand-art.generated.ts");
