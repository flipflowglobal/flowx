import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

interface StatusBadgeProps {
  status: "running" | "active" | "paused" | "stopped" | "live" | "expiring" | "error";
  size?: "sm" | "md";
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  running: { bg: "rgba(34,197,94,0.15)", text: "#22c55e", label: "Running" },
  active: { bg: "rgba(34,197,94,0.15)", text: "#22c55e", label: "Active" },
  live: { bg: "rgba(34,197,94,0.15)", text: "#22c55e", label: "Live" },
  paused: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b", label: "Paused" },
  expiring: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b", label: "Expiring" },
  stopped: { bg: "rgba(239,68,68,0.15)", text: "#ef4444", label: "Stopped" },
  error: { bg: "rgba(239,68,68,0.15)", text: "#ef4444", label: "Error" },
};

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.stopped;
  const pulseAnim = useRef(new Animated.Value(0.6)).current;
  const isActive = status === "running" || status === "active" || status === "live";

  useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [isActive]);

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, size === "md" && styles.badgeMd]}>
      {isActive ? (
        <Animated.View style={[styles.dot, { backgroundColor: config.text, opacity: pulseAnim }]} />
      ) : (
        <View style={[styles.dot, { backgroundColor: config.text }]} />
      )}
      <Text style={[styles.text, { color: config.text }, size === "md" && styles.textMd]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    gap: 5,
  },
  badgeMd: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  textMd: {
    fontSize: 13,
  },
});
