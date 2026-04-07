import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { chainColors } from "@/lib/mockData";

interface ChainBadgeProps {
  chain: string;
}

export function ChainBadge({ chain }: ChainBadgeProps) {
  const color = chainColors[chain] || "#64748b";
  const label = chain.charAt(0).toUpperCase() + chain.slice(1);
  return (
    <View style={[styles.badge, { borderColor: color + "40" }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    borderWidth: 1,
    gap: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  text: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },
});
