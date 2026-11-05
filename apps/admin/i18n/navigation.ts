/**
 * Locale-aware navigation. Use these instead of next/link and next/navigation so links
 * keep the current language: <Link href="/wishlist"> → /es/wishlist for Spanish users.
 */
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
