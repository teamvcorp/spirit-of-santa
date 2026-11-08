/**
 * Family site themes (owner 2026-11-08): "winter" (Winter Magic, the default) and "festive". Colours: app/themes.css.
 *
 * The choice is kept in the browser's localStorage (never a cookie: nothing about it goes to the server, so every page
 * stays prerendered; it's a look preference, not personal data). THEME_SCRIPT runs in <head> before the first paint
 * and accepts ONLY the known names, so a tampered storage value can't inject anything (it's compared, never inserted).
 * Pattern from the Next 16 guide, see docs/vendor/next-theme-script.md.
 */
export const THEMES = ["winter", "festive"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "winter";
export const THEME_STORAGE_KEY = "sos.theme";

export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

/** Inline <head> script. Built from the constants above; no user data is ever interpolated. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(${JSON.stringify(THEMES)}.indexOf(t)>-1)document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
