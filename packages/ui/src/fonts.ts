/**
 * Winter Night fonts (Phase 8.5), loaded ONCE here for all three apps.
 * next/font downloads them at BUILD time and serves them from our own domain: no request to
 * Google from visitors' browsers (privacy) and no layout shift (size-adjusted fallback).
 *  - Fraunces: storybook serif for headings (variable, with the optical-size axis).
 *  - Nunito Sans: friendly, very readable body text.
 * Each app's root layout puts `fontVariables` on <html>; theme.css maps them to font-display / font-sans.
 */
import { Fraunces, Nunito_Sans } from "next/font/google";

const heading = Fraunces({ subsets: ["latin"], variable: "--font-heading", axes: ["opsz"], display: "swap" });
const body = Nunito_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const fontVariables = `${heading.variable} ${body.variable}`;
