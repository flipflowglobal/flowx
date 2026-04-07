import { useSignIn } from "@clerk/expo/legacy";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (!isLoaded) return;
    if (!email.trim() || !password) { setError("Please enter your email and password."); return; }

    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await signIn.create({ identifier: email.trim().toLowerCase(), password });
      await setActive({ session: result.createdSessionId });
      router.replace("/(tabs)" as any);
    } catch (err: any) {
      const msg = err?.errors?.[0]?.message || err?.message || "Sign in failed. Check your credentials.";
      setError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={st.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[st.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={st.logoRow}>
          <View style={st.logoIcon}>
            <Feather name="activity" size={32} color="#3b82f6" />
          </View>
          <Text style={st.logoText}>JDL</Text>
        </View>
        <Text style={st.title}>Welcome back</Text>
        <Text style={st.subtitle}>Sign in to your trading account</Text>

        {error && (
          <View style={st.errorBox}>
            <Feather name="alert-circle" size={15} color="#ef4444" />
            <Text style={st.errorText}>{error}</Text>
          </View>
        )}

        <View style={st.field}>
          <Text style={st.label}>Email</Text>
          <View style={st.inputWrap}>
            <Feather name="mail" size={16} color="#64748b" style={st.inputIcon} />
            <TextInput
              style={st.input}
              placeholder="you@example.com"
              placeholderTextColor="#475569"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
            />
          </View>
        </View>

        <View style={st.field}>
          <Text style={st.label}>Password</Text>
          <View style={st.inputWrap}>
            <Feather name="lock" size={16} color="#64748b" style={st.inputIcon} />
            <TextInput
              style={[st.input, { flex: 1 }]}
              placeholder="Your password"
              placeholderTextColor="#475569"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoComplete="current-password"
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
            />
            <TouchableOpacity onPress={() => setShowPw(v => !v)} style={st.eyeBtn}>
              <Feather name={showPw ? "eye-off" : "eye"} size={16} color="#64748b" />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[st.btn, loading && { opacity: 0.7 }]}
          onPress={handleSignIn}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={st.btnText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <View style={st.footer}>
          <Text style={st.footerText}>Don't have an account? </Text>
          <Link href={"/(auth)/sign-up" as any} asChild>
            <TouchableOpacity>
              <Text style={st.footerLink}>Sign up</Text>
            </TouchableOpacity>
          </Link>
        </View>

        <Text style={st.disclaimer}>
          By signing in you agree to our Terms of Service and Privacy Policy.
          This platform involves cryptocurrency trading which carries significant financial risk.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0e1a" },
  scroll: { flexGrow: 1, paddingHorizontal: 28 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 40 },
  logoIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: "#3b82f620", alignItems: "center", justifyContent: "center" },
  logoText: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#f8fafc", letterSpacing: -1 },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", color: "#f8fafc", letterSpacing: -0.8, marginBottom: 8 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: "#64748b", marginBottom: 32 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#ef444415", borderRadius: 10, padding: 12, marginBottom: 20 },
  errorText: { color: "#ef4444", fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },
  field: { marginBottom: 18 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#94a3b8", marginBottom: 8 },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#0d1225", borderRadius: 12, borderWidth: 1, borderColor: "#1e293b", paddingHorizontal: 14 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, height: 50, color: "#f8fafc", fontFamily: "Inter_400Regular", fontSize: 15 },
  eyeBtn: { padding: 8 },
  btn: { backgroundColor: "#3b82f6", borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", marginTop: 8, marginBottom: 24 },
  btnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 32 },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#64748b" },
  footerLink: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#3b82f6" },
  disclaimer: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#334155", textAlign: "center", lineHeight: 18 },
});
