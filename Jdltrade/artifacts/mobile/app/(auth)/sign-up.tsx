import { useSignUp } from "@clerk/expo/legacy";
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

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [code, setCode] = useState("");

  const handleSignUp = async () => {
    if (!isLoaded) return;
    if (!firstName.trim() || !email.trim() || !password) {
      setError("Please fill in all required fields.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await signUp.create({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        emailAddress: email.trim().toLowerCase(),
        password,
      });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (err: any) {
      const msg = err?.errors?.[0]?.message || err?.message || "Sign up failed. Please try again.";
      setError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);

    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      await setActive({ session: result.createdSessionId });
      router.replace("/(tabs)" as any);
    } catch (err: any) {
      const msg = err?.errors?.[0]?.message || err?.message || "Verification failed. Check the code and try again.";
      setError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  if (pendingVerification) {
    return (
      <KeyboardAvoidingView style={st.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[st.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={st.logoRow}>
            <View style={st.logoIcon}>
              <Feather name="mail" size={28} color="#3b82f6" />
            </View>
            <Text style={st.logoText}>JDL</Text>
          </View>
          <Text style={st.title}>Verify your email</Text>
          <Text style={st.subtitle}>Enter the 6-digit code sent to {email}</Text>

          {error && (
            <View style={st.errorBox}>
              <Feather name="alert-circle" size={15} color="#ef4444" />
              <Text style={st.errorText}>{error}</Text>
            </View>
          )}

          <View style={st.field}>
            <Text style={st.label}>Verification Code</Text>
            <View style={st.inputWrap}>
              <Feather name="hash" size={16} color="#64748b" style={st.inputIcon} />
              <TextInput
                style={st.input}
                placeholder="123456"
                placeholderTextColor="#475569"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                returnKeyType="done"
                onSubmitEditing={handleVerify}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[st.btn, loading && { opacity: 0.7 }]}
            onPress={handleVerify}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={st.btnText}>Verify Email</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

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
        <Text style={st.title}>Create account</Text>
        <Text style={st.subtitle}>Start trading with AI-powered automation</Text>

        {error && (
          <View style={st.errorBox}>
            <Feather name="alert-circle" size={15} color="#ef4444" />
            <Text style={st.errorText}>{error}</Text>
          </View>
        )}

        <View style={st.nameRow}>
          <View style={[st.field, { flex: 1 }]}>
            <Text style={st.label}>First Name *</Text>
            <View style={st.inputWrap}>
              <TextInput
                style={st.input}
                placeholder="John"
                placeholderTextColor="#475569"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
          </View>
          <View style={[st.field, { flex: 1 }]}>
            <Text style={st.label}>Last Name</Text>
            <View style={st.inputWrap}>
              <TextInput
                style={st.input}
                placeholder="Doe"
                placeholderTextColor="#475569"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
          </View>
        </View>

        <View style={st.field}>
          <Text style={st.label}>Email *</Text>
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
          <Text style={st.label}>Password * (8+ characters)</Text>
          <View style={st.inputWrap}>
            <Feather name="lock" size={16} color="#64748b" style={st.inputIcon} />
            <TextInput
              style={[st.input, { flex: 1 }]}
              placeholder="Choose a strong password"
              placeholderTextColor="#475569"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoComplete="new-password"
              returnKeyType="done"
              onSubmitEditing={handleSignUp}
            />
            <TouchableOpacity onPress={() => setShowPw(v => !v)} style={st.eyeBtn}>
              <Feather name={showPw ? "eye-off" : "eye"} size={16} color="#64748b" />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[st.btn, loading && { opacity: 0.7 }]}
          onPress={handleSignUp}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={st.btnText}>Create Account</Text>}
        </TouchableOpacity>

        <View style={st.footer}>
          <Text style={st.footerText}>Already have an account? </Text>
          <Link href={"/(auth)/sign-in" as any} asChild>
            <TouchableOpacity>
              <Text style={st.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </Link>
        </View>

        <Text style={st.disclaimer}>
          By creating an account you agree to our Terms of Service and Privacy Policy.
          Cryptocurrency trading involves substantial financial risk. You may lose capital.
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
  nameRow: { flexDirection: "row", gap: 12 },
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
