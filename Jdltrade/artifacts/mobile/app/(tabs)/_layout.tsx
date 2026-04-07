import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";

let _liquidGlassAvailable: boolean | null = null;

function isLiquidGlassAvailable(): boolean {
  if (_liquidGlassAvailable !== null) return _liquidGlassAvailable;
  try {
    const mod = require("expo-glass-effect");
    if (typeof mod?.isLiquidGlassAvailable === "function") {
      _liquidGlassAvailable = mod.isLiquidGlassAvailable() === true;
    } else {
      _liquidGlassAvailable = false;
    }
  } catch {
    _liquidGlassAvailable = false;
  }
  return _liquidGlassAvailable;
}

let _NativeTabs: any = null;
let _NativeTabsIcon: any = null;
let _NativeTabsLabel: any = null;

function tryLoadNativeTabs() {
  if (_NativeTabs !== null) return !!_NativeTabs;
  try {
    const mod = require("expo-router/unstable-native-tabs");
    if (mod?.NativeTabs && mod?.Icon && mod?.Label) {
      _NativeTabs = mod.NativeTabs;
      _NativeTabsIcon = mod.Icon;
      _NativeTabsLabel = mod.Label;
      return true;
    }
  } catch {}
  _NativeTabs = false;
  return false;
}

function NativeTabLayout() {
  if (!tryLoadNativeTabs()) return <ClassicTabLayout />;
  const NativeTabs = _NativeTabs;
  const Icon = _NativeTabsIcon;
  const Label = _NativeTabsLabel;

  return (
    <NativeTabs>
      {[
        { name: "index",        sf: "chart.bar",              sfSel: "chart.bar.fill",           label: "Dashboard" },
        { name: "agents",       sf: "cpu",                    sfSel: "cpu.fill",                 label: "Agents" },
        { name: "markets",      sf: "chart.xyaxis.line",      sfSel: "chart.xyaxis.line",        label: "Markets" },
        { name: "flash-loans",  sf: "bolt",                   sfSel: "bolt.fill",                label: "Flash Loans" },
        { name: "credit-oracle",sf: "shield.checkered",       sfSel: "shield.checkered",         label: "Credit" },
        { name: "key-portal",   sf: "key",                    sfSel: "key.fill",                 label: "Keys" },
        { name: "activity",     sf: "arrow.left.arrow.right", sfSel: "arrow.left.arrow.right",   label: "Activity" },
        { name: "wallets",      sf: "creditcard",             sfSel: "creditcard.fill",          label: "Wallets" },
        { name: "settings",     sf: "gearshape",              sfSel: "gearshape.fill",           label: "Settings" },
      ].map((t) => (
        <NativeTabs.Trigger key={t.name} name={t.name}>
          <Icon sf={{ default: t.sf, selected: t.sfSel }} />
          <Label>{t.label}</Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

const TAB_ICONS: Record<string, string> = {
  index: "bar-chart-2",
  agents: "cpu",
  markets: "trending-up",
  "flash-loans": "zap",
  "credit-oracle": "shield",
  "key-portal": "key",
  activity: "activity",
  wallets: "credit-card",
  settings: "settings",
};

const TAB_SYMBOLS: Record<string, string> = {
  index: "chart.bar",
  agents: "cpu",
  markets: "chart.xyaxis.line",
  "flash-loans": "bolt",
  "credit-oracle": "shield.checkered",
  "key-portal": "key",
  activity: "arrow.left.arrow.right",
  wallets: "creditcard",
  settings: "gearshape",
};

const TAB_LABELS: Record<string, string> = {
  index: "Dashboard",
  agents: "Agents",
  markets: "Markets",
  "flash-loans": "Flash Loans",
  "credit-oracle": "Credit",
  "key-portal": "Keys",
  activity: "Activity",
  wallets: "Wallets",
  settings: "Settings",
};

function ClassicTabLayout() {
  const colors = useColors();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        lazy: true,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : "rgba(10,14,26,0.95)",
          borderTopWidth: 1,
          borderTopColor: "rgba(255,255,255,0.06)",
          elevation: 0,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.3,
          shadowRadius: 16,
          ...(isWeb ? { height: 84, paddingBottom: 12 } : {}),
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 10,
          letterSpacing: 0.3,
          marginTop: -2,
        },
        tabBarItemStyle: {
          paddingTop: 6,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: "rgba(10,14,26,0.97)", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
              ]}
            />
          ) : null,
      }}
    >
      {Object.entries(TAB_LABELS).map(([name, title]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) =>
              isIOS && TAB_SYMBOLS[name] ? (
                <SymbolView name={TAB_SYMBOLS[name] as any} tintColor={color} size={22} />
              ) : (
                <View style={focused ? styles.activeIconWrap : undefined}>
                  <Feather name={TAB_ICONS[name] as any} size={20} color={color} />
                </View>
              ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  activeIconWrap: {
    backgroundColor: "rgba(59,130,246,0.08)",
    borderRadius: 10,
    padding: 4,
  },
});

export default function TabLayout() {
  if (Platform.OS === "ios" && isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
