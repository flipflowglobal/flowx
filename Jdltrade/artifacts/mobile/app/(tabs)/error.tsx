import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export { ErrorBoundary } from "expo-router";

export default function TabGroupErrorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 80 : insets.top + 20;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: topPad, paddingBottom: 80, paddingHorizontal: 24, flexGrow: 1 }}
    >
      <View style={styles.iconWrap}>
        <View style={styles.iconBg}>
          <Feather name="alert-triangle" size={36} color="#ef4444" />
        </View>
      </View>

      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.subtitle}>
        An unexpected error occurred in this screen. Your data is safe — tap below to go back to the dashboard.
      </Text>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => router.replace("/(tabs)" as any)}
        activeOpacity={0.8}
      >
        <Feather name="home" size={16} color="#fff" />
        <Text style={styles.primaryBtnTxt}>Back to Dashboard</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <Feather name="arrow-left" size={14} color="#6b7280" />
        <Text style={styles.secondaryBtnTxt}>Go Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0e1a",
  },
  iconWrap: {
    alignItems: "center",
    marginBottom: 24,
    marginTop: 40,
  },
  iconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(239,68,68,0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#64748b",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 40,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#3b82f6",
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },
  primaryBtnTxt: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  secondaryBtnTxt: {
    color: "#6b7280",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
