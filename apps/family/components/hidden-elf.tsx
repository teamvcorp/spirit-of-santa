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
import { useEffect, useState } from "react";
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

  function onFind() {
    const progress = findElf(load(elfDay()), page);
    save(progress);
    const n = progress.found.length;
    setMessage(n >= total ? t("all", { total }) : t("found", { count: n, total }));
    setState("found");
  }

  return (
    <>
      {state !== "gone" && (
        <div className="sos-elf-layer">
          <button
            type="button"
            onClick={onFind}
            onAnimationEnd={() => setState("gone")}
            className={`sos-elf sos-elf-${spot.side} ${state === "found" ? "sos-elf-found" : ""}`}
            style={{ top: `${spot.topPct}%` }}
            aria-label={t("label")}
            data-testid="hidden-elf"
            disabled={state === "found"}
          >
            {/* Decorative: the button's label says what it is. */}
            <Image src={ILLUSTRATIONS.elf} alt="" width={64} height={92} draggable={false} />
          </button>
        </div>
      )}
      {/* Polite announcement + a small note at the bottom of the screen; fades by itself. */}
      {message && (
        <p role="status" data-testid="elf-message" className="sos-pop fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-2xl bg-surface px-4 py-3 text-center font-semibold shadow-card">
          {message}
        </p>
      )}
    </>
  );
}
