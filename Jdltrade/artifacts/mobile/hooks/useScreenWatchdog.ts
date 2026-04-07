/**
 * useScreenWatchdog
 *
 * Per-screen self-healing data watchdog. Wraps any async fetch function with:
 *  - Automatic retry with exponential backoff on failure
 *  - Stale-data detection when the last successful fetch is too old
 *  - Pause-and-resume when the system API is offline (from useApiHealth)
 *  - AppState listener to refetch whenever the app returns to foreground
 *  - forceRefresh() for pull-to-refresh / manual retry
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useApiHealth } from "./useApiHealth";

export interface WatchdogConfig {
  fetch: () => Promise<void>;
  intervalMs?: number;
  staleLimitMs?: number;
  maxRetries?: number;
  screenName: string;
}

export interface WatchdogState {
  isStale: boolean;
  isRecovering: boolean;
  errorCount: number;
  lastSuccessAt: Date | null;
  forceRefresh: () => void;
}

export function useScreenWatchdog({
  fetch: fetchFn,
  intervalMs = 30_000,
  staleLimitMs,
  maxRetries = 5,
  screenName,
}: WatchdogConfig): WatchdogState {
  const staleLimit = staleLimitMs ?? intervalMs * 2;

  const [errorCount, setErrorCount] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);

  const { status: apiStatus } = useApiHealth();

  const isMountedRef = useRef(true);
  const errorCountRef = useRef(0);
  const lastSuccessRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiStatusRef = useRef(apiStatus);
  apiStatusRef.current = apiStatus;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const runFetch = useCallback(async (): Promise<boolean> => {
    if (!isMountedRef.current) return false;
    if (apiStatusRef.current === "offline") return false;

    try {
      await fetchFn();
      if (isMountedRef.current) {
        errorCountRef.current = 0;
        setErrorCount(0);
        setIsRecovering(false);
        setIsStale(false);
        const now = Date.now();
        lastSuccessRef.current = now;
        setLastSuccessAt(new Date(now));
      }
      return true;
    } catch {
      if (isMountedRef.current) {
        errorCountRef.current = Math.min(errorCountRef.current + 1, maxRetries);
        setErrorCount(errorCountRef.current);
        setIsRecovering(errorCountRef.current < maxRetries);
      }
      return false;
    }
  }, [fetchFn, maxRetries]);

  const scheduleNext = useCallback(() => {
    clearTimer();
    const backoffMs = Math.min(errorCountRef.current * 15_000, 120_000);
    const delay = errorCountRef.current > 0 ? intervalMs + backoffMs : intervalMs;
    timerRef.current = setTimeout(async () => {
      await runFetch();
      if (isMountedRef.current) scheduleNext();
    }, delay);
  }, [runFetch, intervalMs]);

  const forceRefresh = useCallback(() => {
    clearTimer();
    errorCountRef.current = 0;
    setErrorCount(0);
    setIsRecovering(true);
    runFetch().then(() => {
      if (isMountedRef.current) {
        setIsRecovering(false);
        scheduleNext();
      }
    });
  }, [runFetch, scheduleNext]);

  useEffect(() => {
    isMountedRef.current = true;
    runFetch().then(() => {
      if (isMountedRef.current) scheduleNext();
    });
    return () => {
      isMountedRef.current = false;
      clearTimer();
    };
  }, []);

  useEffect(() => {
    if (apiStatus === "healthy" && errorCountRef.current > 0) {
      forceRefresh();
    }
  }, [apiStatus]);

  useEffect(() => {
    const staleInterval = setInterval(() => {
      if (!isMountedRef.current) return;
      if (lastSuccessRef.current !== null) {
        setIsStale(Date.now() - lastSuccessRef.current > staleLimit);
      }
    }, 15_000);
    return () => clearInterval(staleInterval);
  }, [staleLimit]);

  useEffect(() => {
    const handleChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        const timeSinceLast = lastSuccessRef.current ? Date.now() - lastSuccessRef.current : Infinity;
        if (timeSinceLast > intervalMs) {
          forceRefresh();
        }
      }
    };
    const sub = AppState.addEventListener("change", handleChange);
    return () => sub.remove();
  }, [forceRefresh, intervalMs]);

  return { isStale, isRecovering, errorCount, lastSuccessAt, forceRefresh };
}
