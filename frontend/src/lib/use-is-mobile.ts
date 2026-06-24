import { useEffect, useState } from "react";

const QUERY = "(max-width: 767.98px)"; // below Tailwind's `md` breakpoint

/**
 * True on viewports below the `md` breakpoint. Reads synchronously on first
 * render (no layout flash) and updates on resize. Falls back to `false`
 * (desktop) when `matchMedia` is unavailable, e.g. jsdom under tests — so tests
 * render the single desktop layout and aren't affected by responsive forks.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(QUERY).matches
      : false
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
