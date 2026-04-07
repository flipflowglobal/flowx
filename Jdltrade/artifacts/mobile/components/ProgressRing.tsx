import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  color?: string;
}

export function ProgressRing({
  progress,
  size = 64,
  strokeWidth = 4,
  label,
  color,
}: ProgressRingProps) {
  const colors = useColors();
  const ringColor = color || colors.primary;
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: progress,
      duration: 1200,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const animWidth = animValue.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: strokeWidth,
            borderColor: colors.muted,
          },
        ]}
      />
      <View
        style={[
          styles.ringFill,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: strokeWidth,
            borderColor: "transparent",
            borderTopColor: ringColor,
            borderRightColor: progress > 25 ? ringColor : "transparent",
            borderBottomColor: progress > 50 ? ringColor : "transparent",
            borderLeftColor: progress > 75 ? ringColor : "transparent",
            transform: [{ rotate: "-90deg" }],
          },
        ]}
      />
      <View style={styles.center}>
        <Text style={[styles.value, { color: colors.foreground, fontSize: size * 0.22 }]}>
          {Math.round(progress)}%
        </Text>
        {label && (
          <Text style={[styles.label, { color: colors.mutedForeground, fontSize: size * 0.13 }]}>
            {label}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute" },
  ringFill: { position: "absolute" },
  center: { alignItems: "center" },
  value: { fontFamily: "Inter_700Bold" },
  label: { fontFamily: "Inter_400Regular" },
});
