import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WatchdogBadge, type WatchdogBadgeProps } from "@/components/WatchdogBadge";
import { useColors } from "@/hooks/useColors";

interface JDLHeaderProps {
  subtitle?: string;
  showLogo?: boolean;
  rightAction?: {
    icon: string;
    label: string;
    onPress: () => void;
    color?: string;
  };
  watchdog?: WatchdogBadgeProps;
}

export function JDLHeader({ subtitle, showLogo = true, rightAction, watchdog }: JDLHeaderProps) {
  const colors = useColors();

  if (!showLogo) return null;

  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <View style={[styles.logoWrap, { backgroundColor: colors.primary + "15" }]}>
          <Feather name="hexagon" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
          <View>
            <Text style={[styles.brandName, { color: colors.foreground }]}>JDL</Text>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
            ) : null}
          </View>
          {watchdog && (
            <WatchdogBadge
              isStale={watchdog.isStale}
              isRecovering={watchdog.isRecovering}
              errorCount={watchdog.errorCount}
              onRetry={watchdog.onRetry}
            />
          )}
        </View>
        {rightAction && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: (rightAction.color || colors.primary) + "18", borderColor: (rightAction.color || colors.primary) + "35" }]}
            onPress={() => { rightAction.onPress(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            activeOpacity={0.75}
          >
            <Feather name={rightAction.icon as any} size={14} color={rightAction.color || colors.primary} />
            <Text style={[styles.actionLabel, { color: rightAction.color || colors.primary }]}>{rightAction.label}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: -1,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  actionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
