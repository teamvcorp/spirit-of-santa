"use client";
/**
 * Header switch between the two site looks: Winter Magic / Festive (owner 2026-11-08).
 * Two real <button>s with aria-pressed inside a labelled group (screen readers announce "Winter Magic, pressed").
 * Clicking only changes <html data-theme> + localStorage: the colours are CSS variables (app/themes.css), so the whole
 * page switches instantly with no reload and no server call.
 *
 * Teaching note: the pressed state is READ from <html data-theme> with useSyncExternalStore. On the server (and during
 * hydration) it reports the default, then React re-reads the real attribute that the <head> script set, so there's no
 * hydration mismatch and no flash. A MutationObserver keeps both buttons in sync if anything else changes the theme.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";
import { DEFAULT_THEME, isTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const read = (): Theme => {
  const t = document.documentElement.getAttribute("data-theme");
  return isTheme(t) ? t : DEFAULT_THEME;
};

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeSwitch({ label, winter, festive }: { label: string; winter: string; festive: string }) {
  const current = useSyncExternalStore(subscribe, read, () => DEFAULT_THEME);
  // DEV only: React Strict Mode re-mounts <html> with its JSX attributes, dropping what the <head> script set.
  // Re-apply the saved choice before paint (a no-op in production, where the attribute is already right).
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (isTheme(saved) && read() !== saved) apply(saved);
    } catch {
      /* storage blocked (private mode): the default look stays */
    }
  }, []);

  const choose = (theme: Theme) => {
    apply(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage blocked: the look still changes for this page view */
    }
  };

  const item = (theme: Theme, text: string, icon: React.ReactNode) => {
    const on = current === theme;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => choose(theme)}
        className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm ${on ? "bg-[#f6d27a] font-extrabold text-[#1b2a4a]" : "font-bold text-[#fff8e7]"}`}
      >
        {icon}
        {/* The words stay in the accessibility tree on small phones, where only the icon shows. */}
        <span className="sr-only sm:not-sr-only">{text}</span>
      </button>
    );
  };

  return (
    <div role="group" aria-label={label} className="flex rounded-full border border-[#fff8e7]/25 bg-[#fff8e7]/10 p-[3px]" data-testid="theme-switch">
      {item(
        "winter",
        winter,
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7M9 4l3 2 3-2M9 20l3-2 3 2" />
        </svg>,
      )}
      {item(
        "festive",
        festive,
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="8" width="18" height="13" rx="1.5" />
          <path d="M12 8v13M3 12h18M12 8c-1.5-3-5-3.5-5-1.2C7 8 12 8 12 8zM12 8c1.5-3 5-3.5 5-1.2C17 8 12 8 12 8z" />
        </svg>,
      )}
    </div>
  );
}
