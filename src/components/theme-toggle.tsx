"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon } from "@/components/icons";

const THEME_KEY = "braina-theme";

/** Same-tab listeners; other tabs are covered by the native `storage` event. */
const themeListeners = new Set<() => void>();

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** `ThemeScript` in the root layout already applied the real theme to <html>
 *  before paint, so reading the class back in is all this needs to do. */
function readThemeSnapshot() {
  return document.documentElement.classList.contains("dark");
}

/** A small floating bubble, pinned bottom-right, that flips the whole app
 * between the warm-paper and warm-espresso palettes defined in globals.css. */
export function DarkModeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, readThemeSnapshot, () => false);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {}
    themeListeners.forEach((listener) => listener());
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Turn off dark mode" : "Turn on dark mode"}
      aria-pressed={dark}
      className={`fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom)+0.75rem)] z-50 grid size-10 place-items-center rounded-full border-2 border-foreground shadow-[0_3px_0_0_var(--foreground)] transition-colors active:translate-y-[3px] active:shadow-none md:bottom-6 ${
        dark ? "bg-accent-soft text-accent" : "bg-surface text-foreground hover:bg-surface-2"
      }`}
    >
      <MoonIcon className="size-5" strokeWidth={dark ? 2.4 : 1.9} />
    </button>
  );
}
