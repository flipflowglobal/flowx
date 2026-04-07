/**
 * WatchdogBadge
 *
 * A compact, non-intrusive status pill that appears next to the screen header
 * when the watchdog detects stale data, an active recovery attempt, or
 * persistent fetch errors. Stays invisible when everything is healthy.
 */

import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity } from "react-native";

export interface WatchdogBadgeProps {
  isStale: boolean;
  isRecovering: boolean;
  errorCount: number;
  onRetry: () => void;
}

export function WatchdogBadge({ isStale, isRecovering, errorCount, onRetry }: WatchdogBadgeProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isRecovering) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.25, duration: 550, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      loopRef.current = null;
      Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    return () => {
      loopRef.current?.stop();
    };
  }, [isRecovering]);

  if (!isStale && !isRecovering && errorCount === 0) return null;

  const isError = errorCount > 0 && !isRecovering;
  const color = isRecovering ? "#f59e0b" : isStale ? "#64748b" : "#ef4444";
  const icon: any = isRecovering ? "refresh-cw" : isStale ? "clock" : "alert-circle";
  const label = isRecovering ? "Syncing…" : isStale ? "Stale" : `${errorCount} err`;

  return (
    <TouchableOpacity onPress={onRetry} activeOpacity={0.7} style={styles.wrap}>
      <Animated.View
        style={[
          styles.badge,
          {
            borderColor: color + "45",
            backgroundColor: color + "14",
            opacity: isRecovering ? pulseAnim : 1,
          },
        ]}
      >
        <Feather name={icon} size={9} color={color} />
        <Text style={[styles.label, { color }]}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginLeft: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  label: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
});
