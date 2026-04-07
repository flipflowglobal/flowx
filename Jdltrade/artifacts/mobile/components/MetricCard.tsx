import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { useColors } from "@/hooks/useColors";

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  icon: keyof typeof Feather.glyphMap;
  compact?: boolean;
}

export function MetricCard({ title, value, change, icon, compact }: MetricCardProps) {
  const colors = useColors();
  const isPositive = (change ?? 0) >= 0;

  return (
    <Card style={compact ? styles.compactCard : undefined}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + "15" }]}>
          <Feather name={icon} size={compact ? 14 : 16} color={colors.primary} />
        </View>
        {change !== undefined && (
          <View style={[styles.changeBadge, { backgroundColor: isPositive ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)" }]}>
            <Feather name={isPositive ? "trending-up" : "trending-down"} size={10} color={isPositive ? colors.profit : colors.loss} />
            <Text style={[styles.changeText, { color: isPositive ? colors.profit : colors.loss }]}>
              {isPositive ? "+" : ""}{change.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.value, { color: colors.foreground }, compact && styles.compactValue]}>{value}</Text>
      <Text style={[styles.title, { color: colors.mutedForeground }]}>{title}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  compactCard: { padding: 12 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  changeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  changeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  value: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    marginBottom: 2,
  },
  compactValue: { fontSize: 18 },
  title: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
