"use client";
/**
 * "Fully funded!" celebration (Phase 8.5, owner: "lots of magic"). The first time a child's page is
 * opened after one of their gifts became fully funded, a sparkle burst + card says so, ONCE per gift
 * per device (remembered in localStorage; if storage is blocked it simply shows once per visit).
 * Accessible: a modal dialog with a label, focus moves to its button, Escape or the button closes it;
 * sparkles are decorative and switched off for reduced motion (magic.css).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ILLUSTRATIONS } from "@/lib/illustrations";

const KEY = "sos.celebrated";
const COLORS = ["#e0a526", "#f5c451", "#c8102e", "#9fb7e3", "#ffffff", "#2e9a6a"];
const SPARKS = Array.from({ length: 36 }, (_, i) => {
  const a = (i / 36) * Math.PI * 2;
  const d = 120 + ((i * 37) % 90);
  return { color: COLORS[i % COLORS.length]!, dx: `${Math.round(Math.cos(a) * d)}px`, dy: `${Math.round(Math.sin(a) * d)}px`, delay: `${((i % 6) * 0.04).toFixed(2)}s` };
});

function seen(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function remember(id: string) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...seen(), id].slice(-200)));
  } catch {
    /* storage blocked: it just shows again next visit */
  }
}

export function Celebration({ funded }: { funded: { id: string; name: string }[] }) {
  const t = useTranslations("Celebrate");
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const done = new Set(seen());
    // Reading localStorage can only happen in the browser, after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrent(funded.find((g) => !done.has(g.id)) ?? null);
  }, [funded]);
  useEffect(() => {
    if (current) button.current?.focus();
  }, [current]);

  if (!current) return null;
  const close = () => {
    remember(current.id);
    const done = new Set(seen());
    setCurrent(funded.find((g) => !done.has(g.id)) ?? null);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-deep/75 p-6" onKeyDown={(e) => e.key === "Escape" && close()}>
      {SPARKS.map((s, i) => (
        <span key={i} aria-hidden="true" className="sos-spark" style={{ background: s.color, ["--dx" as string]: s.dx, ["--dy" as string]: s.dy, animationDelay: s.delay }} />
      ))}
      <div role="dialog" aria-modal="true" aria-labelledby="sos-celebrate-title" className="sos-pop relative flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-surface p-7 text-center shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small decorative SVG from /public/illustrations */}
        <img src={ILLUSTRATIONS.giftBox} alt="" width={84} height={84} />
        <h2 id="sos-celebrate-title" className="text-3xl font-bold">
          {t("title")}
        </h2>
        <p className="text-muted">{t("body", { item: current.name })}</p>
        <button ref={button} type="button" onClick={close} className="mt-2 min-h-12 rounded-full bg-primary px-7 font-bold text-on-primary hover:bg-primary-hover">
          {t("button")}
        </button>
      </div>
    </div>
  );
}
