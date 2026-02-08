"use client";

import { useEffect, useState } from "react";

/** True after the first client render (useful to avoid hydration mismatches). */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

/**
 * `matchMedia` helper with Safari legacy fallback.
 * Example: useMediaQuery("(hover: hover) and (pointer: fine)")
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();

    // Safari < 14 fallback
    type LegacyMql = MediaQueryList & {
      addListener?: (cb: () => void) => void;
      removeListener?: (cb: () => void) => void;
    };
    const legacy = mql as LegacyMql;

    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if (legacy.addListener) legacy.addListener(onChange);

    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else if (legacy.removeListener) legacy.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

/**
 * Persist a boolean state in localStorage.
 * If localStorage is not available, it behaves like a normal useState.
 */
export function useLocalStorageBoolean(key: string, defaultValue: boolean) {
  const [value, setValue] = useState<boolean>(defaultValue);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return;
      setValue(raw === "1" || raw === "true");
    } catch {
      // ignore
    }
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
      // ignore
    }
  }, [key, value]);

  return [value, setValue] as const;
}
