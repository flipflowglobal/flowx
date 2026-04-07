import React, { useEffect, useRef } from "react";
import { Animated, type ViewStyle } from "react-native";

interface AnimatedEntryProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: ViewStyle;
  direction?: "up" | "down" | "left" | "right" | "fade";
}

export function AnimatedEntry({
  children,
  delay = 0,
  duration = 420,
  style,
  direction = "up",
}: AnimatedEntryProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(
    new Animated.Value(direction === "up" ? 18 : direction === "down" ? -18 : 0)
  ).current;
  const translateX = useRef(
    new Animated.Value(direction === "left" ? 18 : direction === "right" ? -18 : 0)
  ).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        delay,
        useNativeDriver: true,
        tension: 62,
        friction: 9,
        overshootClamping: true,
      }),
      Animated.spring(translateX, {
        toValue: 0,
        delay,
        useNativeDriver: true,
        tension: 62,
        friction: 9,
        overshootClamping: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        {
          opacity,
          transform: [{ translateY }, { translateX }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
