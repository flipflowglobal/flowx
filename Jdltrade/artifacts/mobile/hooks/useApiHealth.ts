import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { apiFetch } from "@/lib/api";

export type ApiHealthStatus = "healthy" | "degraded" | "offline" | "unknown";

export interface ApiHealth {
  status: ApiHealthStatus;
  lastChecked: Date | null;
  latencyMs: number | null;
  subsystems: Record<string, { ok: boolean; error?: string }>;
  isChecking: boolean;
  retry: () => void;
}

const POLL_INTERVAL_MS = 30_000;
const RETRY_DELAY_MS = 5_000;

export function useApiHealth(): ApiHealth {
  const [status, setStatus] = useState<ApiHealthStatus>("unknown");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [subsystems, setSubsystems] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [isChecking, setIsChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    if (!mountedRef.current) return;
    setIsChecking(true);
    const t0 = Date.now();
    try {
      const data = await apiFetch<any>("/health/detailed");
      const latency = Date.now() - t0;
      if (!mountedRef.current) return;
      setLatencyMs(latency);
      setLastChecked(new Date());
      const mapped: Record<string, { ok: boolean; error?: string }> = {};
      if (data.subsystems) {
        for (const [k, v] of Object.entries(data.subsystems as Record<string, any>)) {
          mapped[k] = { ok: v.ok, error: v.error };
        }
      }
      setSubsystems(mapped);
      setStatus(data.status === "healthy" ? "healthy" : data.status === "degraded" ? "degraded" : "offline");
    } catch {
      if (!mountedRef.current) return;
      setStatus("offline");
      setLastChecked(new Date());
      setLatencyMs(null);
    } finally {
      if (mountedRef.current) setIsChecking(false);
    }
  }, []);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await check();
      scheduleNext();
    }, POLL_INTERVAL_MS);
  }, [check]);

  const retry = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await check();
    scheduleNext();
  }, [check, scheduleNext]);

  useEffect(() => {
    mountedRef.current = true;
    check().then(scheduleNext);

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") retry();
    };
    const sub = AppState.addEventListener("change", handleAppState);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      sub.remove();
    };
  }, []);

  return { status, lastChecked, latencyMs, subsystems, isChecking, retry };
}
