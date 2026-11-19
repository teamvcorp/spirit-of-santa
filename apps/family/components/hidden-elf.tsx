"use client";
/**
 * FIND THE ELF (owner 2026-11-16): a small elf peeks in from the edge of a kid or public page. Each day he hides in
 * a different spot (@repo/lib/elf elfSpot). Tapping him counts him for today ("You found 3 of 10 elves today!").
 *
 * Put <HiddenElf page="…" /> inside a page's <main>, and give that <main> the `relative` class: the elf layer
 * covers the main area and clips him at its edges.
 *
 * Privacy: progress is kept ONLY in this browser (localStorage "sos-elves"); nothing about a child reaches a server.
 * Storage can be blocked (private mode), so every read/write is wrapped: the game then just doesn't remember.
 * Rendering waits for the browser (useHydrated): the spot depends on TODAY, and the page shell is prerendered, so
 * drawing him on the server could show yesterday's spot or mismatch on hydration.
 */
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useHydrated } from "@repo/ui/use-hydrated";
import { useTranslations } from "next-intl";
import { ELF_PAGES, elfDay, elfSpot, findElf, readElfProgress, type ElfPage, type ElfSpot } from "@repo/lib/elf";
import { ILLUSTRATIONS } from "@/lib/illustrations";

const STORAGE_KEY = "sos-elves";

function load(day: string) {
  try {
    return readElfProgress(window.localStorage.getItem(STORAGE_KEY), day);
  } catch {
    return readElfProgress(null, day);
  }
}
function save(progress: ReturnType<typeof load>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // storage blocked: the find still shows its message, it just isn't remembered
  }
}

export function HiddenElf({ page }: { page: ElfPage }) {
  // Server render + hydration: nothing. In the browser: the elf for TODAY.
  return useHydrated() ? <Elf page={page} /> : null;
}

/** Browser only (mounted after hydration), so its first state may read the date and localStorage directly. */
function Elf({ page }: { page: ElfPage }) {
  const t = useTranslations("Elf");
  const [spot] = useState<ElfSpot>(() => elfSpot(page, elfDay()));
  // Already found on this page today: he stays away until tomorrow.
  const [state, setState] = useState<"hiding" | "found" | "gone">(() => (load(elfDay()).found.includes(page) ? "gone" : "hiding"));
  const [message, setMessage] = useState("");

  // The "You found…" note goes away by itself after a few seconds.
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const total = ELF_PAGES.length;
  const noteRef = useRef<HTMLParagraphElement>(null);

  /** He leaves for the day. If he had keyboard focus, hand it to the note (focus never drops to the page top). */
  function leave() {
    if (document.activeElement?.getAttribute("data-testid") === "hidden-elf") noteRef.current?.focus();
    setState("gone");
  }

  function onFind() {
    if (state !== "hiding") return; // aria-disabled (not `disabled`): keeps focus while he hops away
    const progress = findElf(load(elfDay()), page);
    save(progress);
    const n = progress.found.length;
    setMessage(n >= total ? t("all", { total }) : t("found", { count: n, total }));
    // Reduced motion = no hop animation, so no animationend: leave right away (review 2026-11-16).
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) leave();
    else setState("found");
  }

  return (
    <>
      {state !== "gone" && (
        <div className="sos-elf-layer">
          <button
            type="button"
            onClick={onFind}
            onAnimationEnd={leave}
            className={`sos-elf sos-elf-${spot.side} ${state === "found" ? "sos-elf-found" : ""}`}
            style={{ top: `${spot.topPct}%` }}
            aria-label={t("label")}
            aria-disabled={state === "found"}
            data-testid="hidden-elf"
          >
            {/* Decorative: the button's label says what it is. */}
            <Image src={ILLUSTRATIONS.elf} alt="" width={56} height={80} draggable={false} />
          </button>
        </div>
      )}
      {/*
        The live region is ALWAYS in the page (only its text changes): screen readers often miss a status element
        that appears together with its text. Shown as a note ABOVE the bottom tab bar, and it never takes taps.
      */}
      <p
        ref={noteRef}
        tabIndex={-1}
        role="status"
        data-testid="elf-message"
        className={
          message
            ? "sos-pop pointer-events-none fixed inset-x-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-2xl bg-surface px-4 py-3 text-center font-semibold shadow-card outline-none"
            : "sr-only"
        }
      >
        {message}
      </p>
    </>
  );
}
