"use client";
/**
 * "Fully funded!" celebration (Phase 8.5, owner: "lots of magic"). The first time a child's page is
 * opened after one of their gifts became fully funded, a sparkle burst + card says so, ONCE per gift
 * per device: remembered in localStorage AND in memory, so if storage is blocked (e.g. a private
 * window) closing still works and it shows again only on a later visit (review 2026-11-06).
 * Accessible modal: labelled dialog; focus moves in, stays in (Tab can't leave), Escape closes, the
 * page behind can't scroll, and focus returns where it was. Sparkles are decorative and switched
 * off for reduced motion (magic.css).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ILLUSTRATIONS } from "@/lib/illustrations";

const KEY = "sos.celebrated";
// Theme colours (packages/ui/src/theme.css), so a palette change reaches the sparkles too.
const COLORS = ["var(--color-gold)", "var(--color-gold-light)", "var(--color-berry)", "var(--color-flake-day)", "var(--color-snow)", "var(--meter)"];
const SPARKS = Array.from({ length: 36 }, (_, i) => {
  const a = (i / 36) * Math.PI * 2;
  const d = 120 + ((i * 37) % 90);
  return { color: COLORS[i % COLORS.length]!, dx: `${Math.round(Math.cos(a) * d)}px`, dy: `${Math.round(Math.sin(a) * d)}px`, delay: `${((i % 6) * 0.04).toFixed(2)}s` };
});

function stored(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function remember(id: string) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...stored(), id].slice(-200)));
  } catch {
    /* storage blocked: the in-memory set below still closes it for this visit */
  }
}

export function Celebration({ funded }: { funded: { id: string; name: string }[] }) {
  const t = useTranslations("Celebrate");
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null);
  const dismissed = useRef(new Set<string>());
  const button = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);

  const next = () => {
    const done = new Set([...stored(), ...dismissed.current]);
    return funded.find((g) => !done.has(g.id)) ?? null;
  };

  useEffect(() => {
    // Reading localStorage can only happen in the browser, after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrent(next());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when the list changes
  }, [funded]);

  const close = () => {
    if (!current) return;
    dismissed.current.add(current.id);
    remember(current.id);
    setCurrent(next());
  };

  useEffect(() => {
    if (!current) return;
    before.current ??= document.activeElement;
    button.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind can't scroll
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        e.preventDefault(); // the dialog has one control: focus stays on it
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-bind per shown gift
  }, [current]);

  useEffect(() => {
    if (current || !before.current) return;
    (before.current as HTMLElement).focus?.(); // back where the person was
    before.current = null;
  }, [current]);

  if (!current) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-deep/75 p-6">
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
