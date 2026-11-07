/**
 * Link-preview ("share") image: the picture Facebook, iMessage, WhatsApp, Slack, X etc. show when someone shares a
 * link (Open Graph `og:image`, 1200×630). Each public app serves it from `app/[locale]/share-image/route.ts`
 * (prerendered per language) with its own translated title + tagline, so a Spanish link gets a Spanish card.
 *
 * Generic on purpose: it never shows anything about a child or family (QR pages share this same card).
 * Colours MUST match theme.css (PNG renderers can't read CSS variables): night #1b2a4a, gold #e0a526,
 * snow #f8fafc, muted #b8c4db.
 */
import { ImageResponse } from "next/og";
import { LOGO_DATA_URL } from "./brand-art.generated.ts";
import { SHARE_IMAGE_SIZE } from "./share-image-size.ts";

export function renderShareImage({ title, tagline }: { title: string; tagline: string }): ImageResponse {
  const logo = 420;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 56,
          padding: "0 80px",
          background: "#1b2a4a",
          // Thin gold frame, like the badge's ring.
          border: "6px solid #e0a526",
        }}
      >
        <img src={LOGO_DATA_URL} width={logo} height={logo} alt="" />
        <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
          <div style={{ fontSize: 68, fontWeight: 700, color: "#f8fafc", lineHeight: 1.1 }}>{title}</div>
          <div style={{ fontSize: 34, color: "#b8c4db", lineHeight: 1.35 }}>{tagline}</div>
        </div>
      </div>
    ),
    SHARE_IMAGE_SIZE,
  );
}
