/**
 * Demo Mode Hook
 *
 * When active, wraps tRPC data with realistic demo data so the system
 * runs fully populated without a database connection.
 *
 * Enable via: URL param ?demo=1  or  localStorage key "expag_demo"
 */

import { useEffect, useState } from "react";

const DEMO_KEY = "expag_demo";

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  const urlParam = new URLSearchParams(window.location.search).get("demo");
  if (urlParam === "1" || urlParam === "true") return true;
  return localStorage.getItem(DEMO_KEY) === "1";
}

export function setDemoMode(enabled: boolean) {
  if (enabled) {
    localStorage.setItem(DEMO_KEY, "1");
  } else {
    localStorage.removeItem(DEMO_KEY);
  }
}

export function useDemoMode() {
  const [demo, setDemo] = useState(() => isDemoMode());

  useEffect(() => {
    // Sync URL param on mount
    const urlParam = new URLSearchParams(window.location.search).get("demo");
    if (urlParam === "1" || urlParam === "true") {
      localStorage.setItem(DEMO_KEY, "1");
      setDemo(true);
    }
  }, []);

  const toggle = () => {
    const next = !demo;
    setDemoMode(next);
    setDemo(next);
  };

  return { isDemo: demo, toggle };
}

/**
 * Merges tRPC data with demo fallback.
 * If tRPC returned data → use it.
 * If tRPC loading and demo mode → use demo data immediately.
 * If tRPC error and demo mode → use demo data.
 */
export function useDemoData<T>(
  trpcData: T | undefined,
  demoData: T,
  isLoading: boolean
): { data: T; isDemo: boolean } {
  const { isDemo } = useDemoMode();
  if (trpcData !== undefined) return { data: trpcData, isDemo: false };
  if (isDemo || isLoading) return { data: demoData, isDemo };
  return { data: demoData, isDemo };
}
