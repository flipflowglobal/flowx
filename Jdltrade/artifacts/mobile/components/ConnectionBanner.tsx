import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { type ApiHealthStatus } from "@/hooks/useApiHealth";

interface ConnectionBannerProps {
  status: ApiHealthStatus;
  isChecking: boolean;
  onRetry: () => void;
}

export function ConnectionBanner({ status, isChecking, onRetry }: ConnectionBannerProps) {
  const translateY = useRef(new Animated.Value(-60)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const visible = status === "offline" || status === "degraded";

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: visible ? 0 : -60,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

  if (status === "unknown" || status === "healthy") return null;

  const isOffline = status === "offline";
  const bg = isOffline ? "rgba(239,68,68,0.95)" : "rgba(245,158,11,0.95)";
  const icon = isOffline ? "wifi-off" : "alert-triangle";
  const msg = isOffline
    ? "Connection lost — retrying…"
    : "System degraded — some features may be limited";

  return (
    <Animated.View style={[styles.banner, { backgroundColor: bg, transform: [{ translateY }], opacity }]}>
      <Feather name={icon} size={14} color="#fff" />
      <Text style={styles.text}>{msg}</Text>
      {isOffline && (
        <TouchableOpacity onPress={onRetry} disabled={isChecking} style={styles.retryBtn}>
          <Text style={styles.retryText}>{isChecking ? "…" : "Retry"}</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#fff",
  },
  retryBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
