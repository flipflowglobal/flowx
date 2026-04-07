import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedEntry } from "@/components/AnimatedEntry";
import { Card } from "@/components/Card";
import { JDLHeader } from "@/components/JDLHeader";
import { useScreenWatchdog } from "@/hooks/useScreenWatchdog";
import { useColors } from "@/hooks/useColors";
import { useUser, useAuth } from "@clerk/expo";
import { subscriptionTiers, chainColors } from "@/lib/mockData";
import { createCheckoutSession, getCryptoPaymentInfo, getSubscriptionStatus, getActivityTransactions, getUserPreferences, saveUserPreferences, createStripeCheckout, getStripePlans } from "@/lib/api";

const TERMS_TEXT = [
  "Last updated: 5 April 2026",
  "",
  "1. ACCEPTANCE OF TERMS",
  "By accessing or using JDL Autonomous Trading Platform (the Platform), you agree to be bound by these Terms of Service. If you do not agree, do not use the Platform.",
  "",
  "2. ELIGIBILITY",
  "You must be at least 18 years old and legally permitted to trade digital assets in your jurisdiction. The Platform is not available in sanctioned countries or jurisdictions where DeFi trading is prohibited.",
  "",
  "3. SUBSCRIPTION PLANS",
  "JDL offers Free, Pro (A$49/month), and Elite (A$299/month) subscription tiers via GoCardless direct debit. Fees are charged monthly in advance. Subscriptions auto-renew unless cancelled.",
  "",
  "4. FEES",
  "A 0.75% system execution fee is applied to all automated trades. A 2% fee applies when funding an agent wallet via the Platform.",
  "",
  "5. RISK DISCLOSURE",
  "Cryptocurrency trading involves substantial risk of loss. Past performance of trading algorithms does not guarantee future results. You may lose some or all of your capital. JDL algorithms use Monte Carlo simulation, Black-Scholes pricing, Bellman dynamic programming, and Kelly Criterion — these are tools, not guarantees.",
  "",
  "6. NO FINANCIAL ADVICE",
  "JDL does not provide financial, investment, legal, or tax advice. Nothing on this Platform constitutes a recommendation to buy, sell, or hold any digital asset.",
  "",
  "7. LIMITATION OF LIABILITY",
  "To the maximum extent permitted by law, JDL total liability to you shall not exceed the subscription fees paid in the 12 months preceding the claim.",
  "",
  "8. TERMINATION",
  "JDL may suspend or terminate your account for breach of these terms, suspicious activity, or regulatory requirements.",
  "",
  "9. GOVERNING LAW",
  "These terms are governed by the laws of New South Wales, Australia.",
  "",
  "10. CONTACT",
  "For legal inquiries: legal@jdl.trading",
].join("\n");

const PRIVACY_TEXT = [
  "Last updated: 5 April 2026",
  "",
  "1. DATA WE COLLECT",
  "• Account data: name, email address",
  "• Transaction data: trade records, wallet addresses, agent configurations",
  "• Device data: device type, OS version, app version",
  "• Usage data: feature usage, session length",
  "",
  "2. HOW WE USE YOUR DATA",
  "• To execute automated trades on your behalf",
  "• To calculate and charge subscription fees",
  "• To detect fraud and ensure security",
  "• To comply with AML/KYC regulations",
  "• To improve Platform performance and features",
  "",
  "3. DATA STORAGE",
  "All wallet private keys are encrypted using AES-256-GCM encryption before storage. Encryption keys are stored separately from encrypted data.",
  "",
  "4. DATA SHARING",
  "We share data with:",
  "• GoCardless: for payment processing (direct debit)",
  "• Blockchain networks: your wallet addresses are publicly visible on-chain",
  "• Legal authorities: when required by law",
  "",
  "We do NOT sell your personal data to third parties.",
  "",
  "5. DATA RETENTION",
  "Account data is retained for 7 years after account closure to comply with Australian financial regulations.",
  "",
  "6. YOUR RIGHTS",
  "You may request access, correction, or deletion of your personal data by contacting privacy@jdl.trading. Deletion requests are subject to regulatory retention requirements.",
  "",
  "7. COOKIES",
  "The Platform uses essential cookies only for authentication and session management.",
  "",
  "8. CONTACT",
  "privacy@jdl.trading",
].join("\n");

const AML_TEXT = [
  "ANTI-MONEY LAUNDERING & KNOW YOUR CUSTOMER NOTICE",
  "",
  "JDL Autonomous Trading Platform Pty Ltd operates in compliance with Australian AML/CTF laws (Anti-Money Laundering and Counter-Terrorism Financing Act 2006).",
  "",
  "1. IDENTITY VERIFICATION",
  "JDL may require identity verification before activating trading features. This includes:",
  "• Full legal name",
  "• Date of birth",
  "• Government-issued photo ID",
  "• Proof of address (less than 3 months old)",
  "",
  "2. TRANSACTION MONITORING",
  "All transactions are monitored for suspicious activity. JDL is required to report:",
  "• Transactions over A$10,000 (threshold transactions)",
  "• Suspicious transactions regardless of amount",
  "",
  "3. SOURCE OF FUNDS",
  "JDL may request documentation to verify the source of funds deposited to agent wallets, particularly for amounts exceeding A$5,000.",
  "",
  "4. PROHIBITED ACTIVITIES",
  "The Platform must not be used for:",
  "• Money laundering or terrorist financing",
  "• Structuring transactions to avoid reporting thresholds",
  "• Trading on behalf of sanctioned individuals or entities",
  "• Any activity prohibited by AUSTRAC guidelines",
  "",
  "5. REPORTING OBLIGATIONS",
  "JDL reports to AUSTRAC (Australian Transaction Reports and Analysis Centre). User information may be shared with AUSTRAC and law enforcement agencies as required by law.",
  "",
  "6. ACCOUNT SUSPENSION",
  "JDL reserves the right to suspend accounts pending AML/KYC investigation without prior notice.",
  "",
  "7. CONTACT",
  "For compliance inquiries: compliance@jdl.trading",
].join("\n");

function SliderBar({ value, min, max, color, onChange }: { value: number; min: number; max: number; color: string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  const steps = 10;
  return (
    <View style={st.sliderWrap}>
      <View style={[st.sliderTrack, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
        <View style={[st.sliderFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <View style={st.sliderSteps}>
        {Array.from({ length: steps + 1 }).map((_, i) => {
          const stepVal = min + (i / steps) * (max - min);
          return (
            <TouchableOpacity
              key={i}
              style={st.sliderStep}
              onPress={() => { onChange(Math.round(stepVal * 10) / 10); Haptics.selectionAsync(); }}
            >
              <View style={[st.sliderDot, { backgroundColor: stepVal <= value ? color : "rgba(255,255,255,0.1)" }]} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { signOut } = useAuth();

  const userName = user?.fullName || user?.firstName || "JDL User";
  const userEmail = user?.primaryEmailAddress?.emailAddress || "user@jdl.trading";
  const referralCode = user?.id ? `JDL-${user.id.slice(-8).toUpperCase()}` : "JDL-XXXXXXXX";
  const avatarInitials = userName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  const [subPlan, setSubPlan] = useState("free");
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [subscribeTarget, setSubscribeTarget] = useState<{ id: string; name: string } | null>(null);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [renewalWarning, setRenewalWarning] = useState<{ days: number; plan: string } | null>(null);
  const [subStatus, setSubStatus] = useState<{ isRecurring: boolean; expiresAt: string | null; expired: boolean } | null>(null);

  // Customer details form (step 2 of direct debit flow)
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsIsRecurring, setDetailsIsRecurring] = useState(true);
  const [detailsName, setDetailsName] = useState("");
  const [detailsEmail, setDetailsEmail] = useState("");
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Crypto payment modal
  const [showCryptoModal, setShowCryptoModal] = useState(false);
  const [cryptoInfo, setCryptoInfo] = useState<{ address: string; plans: any; supportedChains: any[] } | null>(null);
  const [cryptoCopied, setCryptoCopied] = useState(false);

  const loadSettingsData = useCallback(async () => {
    const [subResult, prefResult] = await Promise.allSettled([
      getSubscriptionStatus(),
      getUserPreferences(),
    ]);
    if (subResult.status === "fulfilled") {
      const s = subResult.value;
      if (s.plan && s.plan !== "free") setSubPlan(s.plan);
      setSubStatus({ isRecurring: s.isRecurring, expiresAt: s.expiresAt, expired: s.expired });
      if (s.renewalWarning && s.daysUntilExpiry !== null) {
        setRenewalWarning({ days: s.daysUntilExpiry, plan: s.plan });
      }
    }
    if (prefResult.status === "fulfilled") {
      const p = prefResult.value.preferences;
      if (p.notifications    !== undefined) setNotifications(p.notifications);
      if (p.autoTrade        !== undefined) setAutoTrade(p.autoTrade);
      if (p.biometric        !== undefined) setBiometric(p.biometric);
      if (p.darkMode         !== undefined) setDarkMode(p.darkMode);
      if (p.soundEffects     !== undefined) setSoundEffects(p.soundEffects);
      if (p.priceAlerts      !== undefined) setPriceAlerts(p.priceAlerts);
      if (p.emailReports     !== undefined) setEmailReports(p.emailReports);
      if (p.flashLoanAlerts  !== undefined) setFlashLoanAlerts(p.flashLoanAlerts);
      if (p.agentHealth      !== undefined) setAgentHealth(p.agentHealth);
      if (p.slippage         !== undefined) setSlippage(p.slippage);
      if (p.gasLimit         !== undefined) setGasLimit(p.gasLimit);
      if (p.maxGasPrice      !== undefined) setMaxGasPrice(p.maxGasPrice);
      if (p.defaultChain     !== undefined) setDefaultChain(p.defaultChain);
      if (p.twoFaEnabled     !== undefined) setTwoFaEnabled(p.twoFaEnabled);
      if (p.sessionTimeout   !== undefined) setSessionTimeout(p.sessionTimeout);
    }
  }, []);

  const watchdog = useScreenWatchdog({ fetch: loadSettingsData, screenName: "Settings", intervalMs: 60_000 });

  const [notifications, setNotifications] = useState(true);
  const [autoTrade, setAutoTrade] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [soundEffects, setSoundEffects] = useState(true);
  const [priceAlerts, setPriceAlerts] = useState(true);
  const [emailReports, setEmailReports] = useState(false);
  const [flashLoanAlerts, setFlashLoanAlerts] = useState(true);
  const [agentHealth, setAgentHealth] = useState(true);
  const [slippage, setSlippage] = useState(0.5);
  const [gasLimit, setGasLimit] = useState(300000);
  const [maxGasPrice, setMaxGasPrice] = useState(50);
  const [defaultChain, setDefaultChain] = useState("ethereum");
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showChainModal, setShowChainModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showAmlModal, setShowAmlModal] = useState(false);
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState(30);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const persistPreference = (key: string, value: any) => {
    saveUserPreferences({ [key]: value }).catch(() => {});
  };

  const toggleSwitch = (key: string, setter: (v: boolean) => void, val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setter(!val);
    persistPreference(key, !val);
  };

  const CHAINS = ["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"];

  const handleSubscribe = (tierId: string, tierName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubscribeTarget({ id: tierId, name: tierName });
    setSubscribeError(null);
    setShowSubscribeModal(true);
  };

  // Stripe card payment
  const handleStripeCheckout = async () => {
    if (!subscribeTarget) return;
    setSubscribeLoading(true);
    setSubscribeError(null);
    try {
      const plansResult = await getStripePlans();
      const matchPlan = plansResult.plans.find(p => p.tier === subscribeTarget.id);
      const priceId = matchPlan?.prices?.[0]?.priceId;
      if (!priceId) {
        setSubscribeError("Stripe plan not found. Please try GoCardless or Crypto instead.");
        return;
      }
      const result = await createStripeCheckout(priceId, subscribeTarget.id);
      if (result.url) {
        setShowSubscribeModal(false);
        await WebBrowser.openBrowserAsync(result.url, {
          dismissButtonStyle: "close",
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        });
      } else {
        setSubscribeError("Could not create Stripe checkout. Please try again.");
      }
    } catch (err: any) {
      setSubscribeError(err?.message || "Stripe checkout failed. Please try another payment method.");
    } finally {
      setSubscribeLoading(false);
    }
  };

  // Step 2: open customer details form before GoCardless redirect
  const handleOpenDetails = (isRecurring: boolean) => {
    setDetailsIsRecurring(isRecurring);
    setDetailsName(userName);
    setDetailsEmail(userEmail);
    setDetailsError(null);
    setShowSubscribeModal(false);
    setShowDetailsModal(true);
  };

  // Step 3: submit details → create billing request → open GoCardless hosted page
  const handleSubmitDetails = async () => {
    if (!subscribeTarget) return;
    const trimmedName = detailsName.trim();
    const trimmedEmail = detailsEmail.trim();
    if (!trimmedName) { setDetailsError("Please enter your full name."); return; }
    if (!trimmedEmail || !trimmedEmail.includes("@")) { setDetailsError("Please enter a valid email address."); return; }
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const result = await createCheckoutSession(subscribeTarget.id, trimmedEmail, trimmedName, detailsIsRecurring);
      const url = result.authorisationUrl || result.checkoutUrl;
      if (url) {
        setShowDetailsModal(false);
        await WebBrowser.openBrowserAsync(url, {
          dismissButtonStyle: "close",
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        });
      } else {
        setDetailsError(result.message || "Could not create payment link. Please try again.");
      }
    } catch (err: any) {
      setDetailsError(err?.message || "Payment setup failed. Please check your details and try again.");
    } finally {
      setDetailsLoading(false);
    }
  };

  // Open the crypto payment modal with fetched info
  const handleOpenCrypto = async () => {
    if (!subscribeTarget) return;
    setSubscribeLoading(true);
    setSubscribeError(null);
    try {
      const info = await getCryptoPaymentInfo();
      setCryptoInfo(info);
      setShowSubscribeModal(false);
      setShowCryptoModal(true);
    } catch {
      setCryptoInfo({
        address: "0x8C117222E14DcAA20fE3087C491b1d330D0F625a",
        plans: { pro: { amountAud: 49 }, elite: { amountAud: 299 } },
        supportedChains: [
          { name: "Ethereum" }, { name: "Polygon" }, { name: "BSC" }, { name: "Arbitrum" },
        ],
      });
      setShowSubscribeModal(false);
      setShowCryptoModal(true);
    } finally {
      setSubscribeLoading(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!cryptoInfo?.address) return;
    await Clipboard.setStringAsync(cryptoInfo.address);
    setCryptoCopied(true);
    setTimeout(() => setCryptoCopied(false), 2500);
  };

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : 100, paddingTop: topPad }}
        showsVerticalScrollIndicator={false}
      >
        <JDLHeader subtitle="Settings" watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }} />

        {renewalWarning && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              if (subscribeTarget) return;
              const plan = renewalWarning.plan;
              const tierName = plan.charAt(0).toUpperCase() + plan.slice(1);
              setSubscribeTarget({ id: plan, name: tierName });
              setShowSubscribeModal(true);
            }}
            style={{
              marginHorizontal: 20,
              marginTop: 12,
              marginBottom: 4,
              backgroundColor: "#f59e0b18",
              borderWidth: 1,
              borderColor: "#f59e0b50",
              borderRadius: 14,
              flexDirection: "row",
              alignItems: "center",
              padding: 14,
              gap: 12,
            }}
          >
            <Feather name="alert-circle" size={20} color="#f59e0b" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#f59e0b" }}>
                Subscription Expiring Soon
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#f59e0bcc", marginTop: 2 }}>
                Your {renewalWarning.plan.toUpperCase()} plan expires in {renewalWarning.days} day{renewalWarning.days !== 1 ? "s" : ""}. Tap to renew.
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color="#f59e0b" />
          </TouchableOpacity>
        )}

        <AnimatedEntry delay={0}>
          <Card style={{ ...st.profileCard, marginHorizontal: 20, marginTop: 16 }} elevated>
            <View style={[st.avatar, { backgroundColor: colors.primary }]}>
              <Text style={st.avatarText}>{avatarInitials}</Text>
            </View>
            <Text style={[st.profileName, { color: colors.foreground }]}>{userName}</Text>
            <Text style={[st.profileEmail, { color: colors.mutedForeground }]}>{userEmail}</Text>
            <View style={st.badgeRow}>
              <View style={[st.proBadge, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="star" size={10} color={colors.primary} />
                <Text style={[st.proBadgeText, { color: colors.primary }]}>{subPlan.toUpperCase()}</Text>
              </View>
              <View style={[st.kycBadge, { backgroundColor: "rgba(34,197,94,0.1)" }]}>
                <Feather name="check-circle" size={11} color="#22c55e" />
                <Text style={[st.kycText, { color: "#22c55e" }]}>KYC Verified</Text>
              </View>
            </View>
            <View style={st.profileStats}>
              <View style={st.profileStat}>
                <Text style={[st.profileStatValue, { color: colors.foreground }]}>Mar 2024</Text>
                <Text style={[st.profileStatLabel, { color: colors.mutedForeground }]}>Joined</Text>
              </View>
              <View style={[st.profileStatDivider, { backgroundColor: colors.border }]} />
              <View style={st.profileStat}>
                <Text style={[st.profileStatValue, { color: colors.primary }]}>{referralCode}</Text>
                <Text style={[st.profileStatLabel, { color: colors.mutedForeground }]}>Referral</Text>
              </View>
            </View>
          </Card>
        </AnimatedEntry>

        <AnimatedEntry delay={80}>
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>Subscription</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={100}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tiersScroll}>
            {subscriptionTiers.map((tier) => {
              const isCurrent = tier.id === subPlan;
              return (
                <Card key={tier.id} style={{ ...st.tierCard, ...(isCurrent ? { borderColor: colors.primary, borderWidth: 2 } : {}) }} elevated>
                  {isCurrent && (
                    <View style={[st.currentBadge, { backgroundColor: colors.primary }]}>
                      <Text style={st.currentBadgeText}>Current</Text>
                    </View>
                  )}
                  <Text style={[st.tierName, { color: colors.foreground }]}>{tier.name}</Text>
                  <View style={st.tierPriceRow}>
                    <Text style={[st.tierPrice, { color: colors.foreground }]}>{tier.price === 0 ? "$0" : `A$${tier.price}`}</Text>
                    <Text style={[st.tierPeriod, { color: colors.mutedForeground }]}>/mo</Text>
                  </View>
                  <View style={[st.tierDivider, { backgroundColor: colors.border }]} />
                  {tier.features.map((f) => (
                    <View key={f} style={st.featureRow}>
                      <Feather name="check" size={12} color={colors.profit} />
                      <Text style={[st.featureText, { color: colors.mutedForeground }]}>{f}</Text>
                    </View>
                  ))}
                  {!isCurrent && (
                    <TouchableOpacity
                      style={[st.upgradeBtn, { backgroundColor: tier.id === "elite" ? colors.primary : colors.muted }]}
                      activeOpacity={0.7}
                      onPress={() => handleSubscribe(tier.id, tier.name)}
                    >
                      <Text style={[st.upgradeBtnText, { color: tier.id === "elite" ? "#fff" : colors.foreground }]}>
                        {tier.price === 0 ? "Downgrade" : "Subscribe · AUD"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </Card>
              );
            })}
          </ScrollView>
        </AnimatedEntry>

        <AnimatedEntry delay={140}>
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>Trading Configuration</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={160}>
          <View style={st.settingsList}>
            <Card style={st.sliderCard} elevated>
              <View style={st.sliderHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[st.settingIcon, { backgroundColor: "#f59e0b15" }]}>
                    <Feather name="sliders" size={16} color="#f59e0b" />
                  </View>
                  <View>
                    <Text style={[st.settingLabel, { color: colors.foreground }]}>Slippage Tolerance</Text>
                    <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>Max price movement accepted</Text>
                  </View>
                </View>
                <Text style={[st.sliderValue, { color: "#f59e0b" }]}>{slippage}%</Text>
              </View>
              <SliderBar value={slippage} min={0.1} max={5} color="#f59e0b" onChange={(v) => { setSlippage(v); persistPreference("slippage", v); }} />
              <View style={st.sliderLabels}>
                <Text style={[st.sliderLabelText, { color: colors.mutedForeground }]}>0.1%</Text>
                <Text style={[st.sliderLabelText, { color: colors.mutedForeground }]}>5%</Text>
              </View>
            </Card>

            <Card style={st.sliderCard} elevated>
              <View style={st.sliderHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[st.settingIcon, { backgroundColor: "#ef444415" }]}>
                    <Feather name="thermometer" size={16} color="#ef4444" />
                  </View>
                  <View>
                    <Text style={[st.settingLabel, { color: colors.foreground }]}>Max Gas Price</Text>
                    <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>Skip trades above this gas</Text>
                  </View>
                </View>
                <Text style={[st.sliderValue, { color: "#ef4444" }]}>{maxGasPrice} Gwei</Text>
              </View>
              <SliderBar value={maxGasPrice} min={5} max={200} color="#ef4444" onChange={(v) => { const next = Math.round(v); setMaxGasPrice(next); persistPreference("maxGasPrice", next); }} />
              <View style={st.sliderLabels}>
                <Text style={[st.sliderLabelText, { color: colors.mutedForeground }]}>5 Gwei</Text>
                <Text style={[st.sliderLabelText, { color: colors.mutedForeground }]}>200 Gwei</Text>
              </View>
            </Card>

            <Card style={st.settingCard} elevated onPress={() => { setShowChainModal(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
              <View style={st.settingRow}>
                <View style={st.settingLeft}>
                  <View style={[st.settingIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Feather name="globe" size={16} color={colors.primary} />
                  </View>
                  <View>
                    <Text style={[st.settingLabel, { color: colors.foreground }]}>Default Network</Text>
                    <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>{defaultChain.charAt(0).toUpperCase() + defaultChain.slice(1)}</Text>
                  </View>
                </View>
                <View style={[st.chainIndicator, { backgroundColor: (chainColors[defaultChain] || "#64748b") + "20" }]}>
                  <View style={[st.chainDot, { backgroundColor: chainColors[defaultChain] || "#64748b" }]} />
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </View>
              </View>
            </Card>

            <Card style={st.settingCard} elevated>
              <View style={st.settingRow}>
                <View style={st.settingLeft}>
                  <View style={[st.settingIcon, { backgroundColor: "#8b5cf615" }]}>
                    <Feather name="box" size={16} color="#8b5cf6" />
                  </View>
                  <View>
                    <Text style={[st.settingLabel, { color: colors.foreground }]}>Gas Limit</Text>
                    <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>Max gas units per transaction</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[st.gasLimitBtn, { backgroundColor: colors.muted }]}
                  onPress={() => {
                    Alert.prompt ? Alert.prompt("Gas Limit", "Enter gas limit:", (val) => { if (val) { const next = parseInt(val) || 300000; setGasLimit(next); persistPreference("gasLimit", next); } }) :
                    Alert.alert("Gas Limit", `Current: ${gasLimit.toLocaleString()}\nOptions:`, [
                      { text: "200K", onPress: () => { setGasLimit(200000); persistPreference("gasLimit", 200000); } },
                      { text: "300K", onPress: () => { setGasLimit(300000); persistPreference("gasLimit", 300000); } },
                      { text: "500K", onPress: () => { setGasLimit(500000); persistPreference("gasLimit", 500000); } },
                      { text: "Cancel" },
                    ]);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text style={[st.gasLimitText, { color: "#8b5cf6" }]}>{(gasLimit / 1000).toFixed(0)}K</Text>
                </TouchableOpacity>
              </View>
            </Card>
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={200}>
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>Notifications</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={220}>
          <View style={st.settingsList}>
            {[
              { label: "Push Notifications", icon: "bell" as const, desc: "Trade alerts & signals", value: notifications, setter: setNotifications, color: colors.primary, prefKey: "notifications" },
              { label: "Price Alerts", icon: "trending-up" as const, desc: "Token price movements", value: priceAlerts, setter: setPriceAlerts, color: "#22c55e", prefKey: "priceAlerts" },
              { label: "Flash Loan Alerts", icon: "zap" as const, desc: "New arb opportunities", value: flashLoanAlerts, setter: setFlashLoanAlerts, color: "#f59e0b", prefKey: "flashLoanAlerts" },
              { label: "Agent Health Alerts", icon: "heart" as const, desc: "Degradation warnings", value: agentHealth, setter: setAgentHealth, color: "#ef4444", prefKey: "agentHealth" },
              { label: "Email Reports", icon: "mail" as const, desc: "Weekly performance digest", value: emailReports, setter: setEmailReports, color: "#8b5cf6", prefKey: "emailReports" },
              { label: "Sound Effects", icon: "volume-2" as const, desc: "Haptic & audio feedback", value: soundEffects, setter: setSoundEffects, color: "#06b6d4", prefKey: "soundEffects" },
            ].map((item) => (
              <Card key={item.label} style={st.settingCard}>
                <View style={st.settingRow}>
                  <View style={st.settingLeft}>
                    <View style={[st.settingIcon, { backgroundColor: item.color + "12" }]}>
                      <Feather name={item.icon} size={16} color={item.color} />
                    </View>
                    <View>
                      <Text style={[st.settingLabel, { color: colors.foreground }]}>{item.label}</Text>
                      <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>{item.desc}</Text>
                    </View>
                  </View>
                  <Switch
                    value={item.value}
                    onValueChange={() => toggleSwitch(item.prefKey, item.setter, item.value)}
                    trackColor={{ false: colors.muted, true: item.color + "60" }}
                    thumbColor={item.value ? item.color : colors.mutedForeground}
                  />
                </View>
              </Card>
            ))}
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={260}>
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>Preferences</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={280}>
          <View style={st.settingsList}>
            {[
              { label: "Auto-Trade Execution", icon: "zap" as const, desc: "Execute trades automatically", value: autoTrade, setter: setAutoTrade, prefKey: "autoTrade" },
              { label: "Biometric Lock", icon: "lock" as const, desc: "Face ID / Fingerprint", value: biometric, setter: setBiometric, prefKey: "biometric" },
              { label: "Dark Mode", icon: "moon" as const, desc: "Dark trading interface", value: darkMode, setter: setDarkMode, prefKey: "darkMode" },
            ].map((item) => (
              <Card key={item.label} style={st.settingCard}>
                <View style={st.settingRow}>
                  <View style={st.settingLeft}>
                    <View style={[st.settingIcon, { backgroundColor: colors.primary + "12" }]}>
                      <Feather name={item.icon} size={16} color={colors.primary} />
                    </View>
                    <View>
                      <Text style={[st.settingLabel, { color: colors.foreground }]}>{item.label}</Text>
                      <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>{item.desc}</Text>
                    </View>
                  </View>
                  <Switch
                    value={item.value}
                    onValueChange={() => toggleSwitch(item.prefKey, item.setter, item.value)}
                    trackColor={{ false: colors.muted, true: colors.primary + "60" }}
                    thumbColor={item.value ? colors.primary : colors.mutedForeground}
                  />
                </View>
              </Card>
            ))}
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={320}>
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>Account & Security</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={340}>
          <View style={st.settingsList}>
            {[
              { label: "Security Settings", icon: "shield" as const, desc: "2FA, passwords, sessions", action: () => setShowSecurityModal(true) },
              {
                label: "Export Data", icon: "download" as const, desc: "Download trade history", action: () =>
                  Alert.alert("Export Trade History", "Copy your complete trade history as CSV to clipboard?", [
                    {
                      text: "Export CSV",
                      onPress: async () => {
                        try {
                          const { transactions } = await getActivityTransactions();
                          const header = "Date,Type,Token,Amount USD,Chain,Status,PnL,Tx Hash\n";
                          const rows = transactions.map((t: any) =>
                            [
                              new Date(t.timestamp).toLocaleDateString("en-AU"),
                              t.type,
                              t.token,
                              (t.amountUsd ?? 0).toFixed(2),
                              t.chain,
                              t.status,
                              (t.pnl ?? 0).toFixed(2),
                              t.txHash,
                            ].join(",")
                          ).join("\n");
                          await Clipboard.setStringAsync(header + rows);
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          Alert.alert("Exported", `${transactions.length} transactions copied to clipboard as CSV.`);
                        } catch {
                          Alert.alert("Export Failed", "Could not fetch trade data. Please try again.");
                        }
                      },
                    },
                    { text: "Cancel", style: "cancel" },
                  ])
              },
              { label: "Terms of Service", icon: "file-text" as const, desc: "Platform terms & conditions", action: () => setShowTermsModal(true) },
              { label: "Privacy Policy", icon: "eye-off" as const, desc: "How we handle your data", action: () => setShowPrivacyModal(true) },
              { label: "AML / KYC Notice", icon: "alert-circle" as const, desc: "Compliance & risk disclosure", action: () => setShowAmlModal(true) },
              { label: "Support", icon: "help-circle" as const, desc: "Help center & tickets", action: () => Alert.alert("Support", "Contact us at support@jdl.trading") },
            ].map((item) => (
              <Card key={item.label} style={st.settingCard} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); item.action(); }}>
                <View style={st.settingRow}>
                  <View style={st.settingLeft}>
                    <View style={[st.settingIcon, { backgroundColor: colors.primary + "12" }]}>
                      <Feather name={item.icon} size={16} color={colors.primary} />
                    </View>
                    <View>
                      <Text style={[st.settingLabel, { color: colors.foreground }]}>{item.label}</Text>
                      <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>{item.desc}</Text>
                    </View>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </View>
              </Card>
            ))}
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={380}>
          <TouchableOpacity
            style={[st.logoutBtn, { borderColor: colors.destructive + "25" }]}
            activeOpacity={0.7}
            onPress={() => Alert.alert("Sign Out", "Are you sure you want to sign out?", [
              {
                text: "Sign Out",
                style: "destructive",
                onPress: async () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  try { await signOut(); } catch {}
                },
              },
              { text: "Cancel", style: "cancel" },
            ])}
          >
            <Feather name="log-out" size={16} color={colors.destructive} />
            <Text style={[st.logoutText, { color: colors.destructive }]}>Sign Out</Text>
          </TouchableOpacity>
        </AnimatedEntry>

        <Text style={[st.version, { color: colors.mutedForeground }]}>JDL Autonomous Trading v2.0.0 · Build 2026.04</Text>
      </ScrollView>

      <Modal visible={showSecurityModal} transparent animationType="slide" onRequestClose={() => setShowSecurityModal(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.card }]}>
            <View style={st.modalHandle} />
            <View style={st.modalTitleRow}>
              <Text style={[st.modalTitle, { color: colors.foreground }]}>Security Settings</Text>
              <TouchableOpacity onPress={() => setShowSecurityModal(false)}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>

            <Card style={st.securityCard}>
              <View style={st.settingRow}>
                <View style={st.settingLeft}>
                  <View style={[st.settingIcon, { backgroundColor: "#22c55e15" }]}>
                    <Feather name="smartphone" size={16} color="#22c55e" />
                  </View>
                  <View>
                    <Text style={[st.settingLabel, { color: colors.foreground }]}>Two-Factor Auth</Text>
                    <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>TOTP authenticator app</Text>
                  </View>
                </View>
                <Switch value={twoFaEnabled} onValueChange={() => { const next = !twoFaEnabled; setTwoFaEnabled(next); persistPreference("twoFaEnabled", next); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }} trackColor={{ false: colors.muted, true: "#22c55e60" }} thumbColor={twoFaEnabled ? "#22c55e" : colors.mutedForeground} />
              </View>
            </Card>

            <Card style={st.securityCard}>
              <View style={st.sliderHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[st.settingIcon, { backgroundColor: "#f59e0b15" }]}>
                    <Feather name="clock" size={16} color="#f59e0b" />
                  </View>
                  <View>
                    <Text style={[st.settingLabel, { color: colors.foreground }]}>Session Timeout</Text>
                    <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>Auto-lock after inactivity</Text>
                  </View>
                </View>
                <Text style={[st.sliderValue, { color: "#f59e0b" }]}>{sessionTimeout}m</Text>
              </View>
              <SliderBar value={sessionTimeout} min={5} max={120} color="#f59e0b" onChange={(v) => { const next = Math.round(v); setSessionTimeout(next); persistPreference("sessionTimeout", next); }} />
            </Card>

            <Card style={st.securityCard}>
              <TouchableOpacity style={st.settingRow} onPress={() => Alert.alert("Change Password", `A password reset email will be sent to:\n${userEmail}\n\nCheck your inbox and follow the instructions.`, [{ text: "OK" }])}>
                <View style={st.settingLeft}>
                  <View style={[st.settingIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Feather name="lock" size={16} color={colors.primary} />
                  </View>
                  <View>
                    <Text style={[st.settingLabel, { color: colors.foreground }]}>Change Password</Text>
                    <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>Last changed 30 days ago</Text>
                  </View>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </Card>

            <Card style={st.securityCard}>
              <TouchableOpacity style={st.settingRow} onPress={() => Alert.alert("Active Sessions", "You have 2 active sessions.\n\n1. Web Browser - Chrome\n2. Mobile App - iOS\n\nRevoke all other sessions?", [{ text: "Revoke All", style: "destructive" }, { text: "Cancel" }])}>
                <View style={st.settingLeft}>
                  <View style={[st.settingIcon, { backgroundColor: "#ef444415" }]}>
                    <Feather name="monitor" size={16} color="#ef4444" />
                  </View>
                  <View>
                    <Text style={[st.settingLabel, { color: colors.foreground }]}>Active Sessions</Text>
                    <Text style={[st.settingDesc, { color: colors.mutedForeground }]}>2 devices connected</Text>
                  </View>
                </View>
                <View style={[st.sessionBadge, { backgroundColor: "#ef444415" }]}>
                  <Text style={{ color: "#ef4444", fontSize: 11, fontFamily: "Inter_700Bold" }}>2</Text>
                </View>
              </TouchableOpacity>
            </Card>
          </View>
        </View>
      </Modal>

      <Modal visible={showChainModal} transparent animationType="slide" onRequestClose={() => setShowChainModal(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.card }]}>
            <View style={st.modalHandle} />
            <View style={st.modalTitleRow}>
              <Text style={[st.modalTitle, { color: colors.foreground }]}>Default Network</Text>
              <TouchableOpacity onPress={() => setShowChainModal(false)}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>

            <Text style={[st.chainSubtitle, { color: colors.mutedForeground }]}>Select your preferred network for transactions:</Text>

            {CHAINS.map((chain) => (
              <TouchableOpacity
                key={chain}
                style={[st.chainRow, {
                  backgroundColor: defaultChain === chain ? (chainColors[chain] || "#64748b") + "12" : "transparent",
                  borderColor: defaultChain === chain ? (chainColors[chain] || "#64748b") + "40" : colors.border,
                }]}
                onPress={() => { setDefaultChain(chain); persistPreference("defaultChain", chain); Haptics.selectionAsync(); }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={[st.chainIcon, { backgroundColor: (chainColors[chain] || "#64748b") + "20" }]}>
                    <View style={[st.chainDot, { backgroundColor: chainColors[chain] || "#64748b", width: 12, height: 12, borderRadius: 6 }]} />
                  </View>
                  <Text style={[st.chainName, { color: colors.foreground }]}>{chain.charAt(0).toUpperCase() + chain.slice(1)}</Text>
                </View>
                {defaultChain === chain && <Feather name="check-circle" size={20} color={chainColors[chain] || "#64748b"} />}
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={[st.doneBtn, { backgroundColor: colors.primary }]} onPress={() => setShowChainModal(false)}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showTermsModal} transparent animationType="slide" onRequestClose={() => setShowTermsModal(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.card, maxHeight: "90%" }]}>
            <View style={st.modalHandle} />
            <View style={st.modalTitleRow}>
              <Text style={[st.modalTitle, { color: colors.foreground }]}>Terms of Service</Text>
              <TouchableOpacity onPress={() => setShowTermsModal(false)}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[st.legalText, { color: colors.mutedForeground }]}>{TERMS_TEXT}</Text>
            </ScrollView>
            <TouchableOpacity style={[st.doneBtn, { backgroundColor: colors.primary, marginTop: 12 }]} onPress={() => setShowTermsModal(false)}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showPrivacyModal} transparent animationType="slide" onRequestClose={() => setShowPrivacyModal(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.card, maxHeight: "90%" }]}>
            <View style={st.modalHandle} />
            <View style={st.modalTitleRow}>
              <Text style={[st.modalTitle, { color: colors.foreground }]}>Privacy Policy</Text>
              <TouchableOpacity onPress={() => setShowPrivacyModal(false)}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[st.legalText, { color: colors.mutedForeground }]}>{PRIVACY_TEXT}</Text>
            </ScrollView>
            <TouchableOpacity style={[st.doneBtn, { backgroundColor: colors.primary, marginTop: 12 }]} onPress={() => setShowPrivacyModal(false)}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showAmlModal} transparent animationType="slide" onRequestClose={() => setShowAmlModal(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.card, maxHeight: "90%" }]}>
            <View style={st.modalHandle} />
            <View style={st.modalTitleRow}>
              <Text style={[st.modalTitle, { color: colors.foreground }]}>AML / KYC Notice</Text>
              <TouchableOpacity onPress={() => setShowAmlModal(false)}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[st.legalText, { color: colors.mutedForeground }]}>{AML_TEXT}</Text>
            </ScrollView>
            <TouchableOpacity style={[st.doneBtn, { backgroundColor: colors.primary, marginTop: 12 }]} onPress={() => setShowAmlModal(false)}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>I Understand</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Customer details form modal ───────────────────────────────── */}
      <Modal visible={showDetailsModal} transparent animationType="slide" onRequestClose={() => setShowDetailsModal(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.card }]}>
            <View style={st.modalHandle} />
            <View style={st.modalTitleRow}>
              <View>
                <Text style={[st.modalTitle, { color: colors.foreground }]}>
                  {detailsIsRecurring ? "Monthly Subscription" : "One-Month Subscription"}
                </Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
                  {subscribeTarget?.name} · A${subscribeTarget?.id === "pro" ? "49" : "299"}/mo via direct debit
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowDetailsModal(false)}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Type badge */}
            <View style={{ flexDirection: "row", marginBottom: 16, gap: 8 }}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: detailsIsRecurring ? "#22c55e18" : "#a855f718", borderWidth: 1, borderColor: detailsIsRecurring ? "#22c55e40" : "#a855f740" }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: detailsIsRecurring ? "#22c55e" : "#a855f7" }}>
                  {detailsIsRecurring ? "Auto-renewing" : "One-time · 30 days"}
                </Text>
              </View>
            </View>

            {/* Full Name */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, marginBottom: 6 }}>FULL NAME</Text>
            <TextInput
              value={detailsName}
              onChangeText={setDetailsName}
              placeholder="Your full name"
              placeholderTextColor={colors.mutedForeground}
              style={{
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                fontFamily: "Inter_400Regular",
                color: colors.foreground,
                marginBottom: 12,
              }}
              autoCapitalize="words"
              autoCorrect={false}
            />

            {/* Email */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, marginBottom: 6 }}>EMAIL ADDRESS</Text>
            <TextInput
              value={detailsEmail}
              onChangeText={setDetailsEmail}
              placeholder="your@email.com"
              placeholderTextColor={colors.mutedForeground}
              style={{
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                fontFamily: "Inter_400Regular",
                color: colors.foreground,
                marginBottom: 16,
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {/* Error */}
            {detailsError && (
              <View style={{ backgroundColor: "#ef444418", borderWidth: 1, borderColor: "#ef444430", borderRadius: 10, padding: 12, marginBottom: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <Feather name="alert-circle" size={15} color="#ef4444" style={{ marginTop: 1 }} />
                <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#ef4444", lineHeight: 18 }}>{detailsError}</Text>
              </View>
            )}

            {/* Note */}
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 16, padding: 12, backgroundColor: "rgba(59,130,246,0.06)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(59,130,246,0.15)" }}>
              <Feather name="info" size={14} color="#3b82f6" style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 17 }}>
                You will be redirected to GoCardless to securely enter your bank account details. We never store your banking information.
              </Text>
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", opacity: detailsLoading ? 0.7 : 1 }}
              onPress={handleSubmitDetails}
              disabled={detailsLoading}
              activeOpacity={0.8}
            >
              {detailsLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>Continue to Bank Setup</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={{ marginTop: 10, paddingVertical: 12, alignItems: "center" }} onPress={() => setShowDetailsModal(false)}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Crypto payment modal ──────────────────────────────────────── */}
      <Modal visible={showCryptoModal} transparent animationType="slide" onRequestClose={() => setShowCryptoModal(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.card }]}>
            <View style={st.modalHandle} />
            <View style={st.modalTitleRow}>
              <View>
                <Text style={[st.modalTitle, { color: colors.foreground }]}>Pay with Crypto</Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
                  {subscribeTarget?.name} · A${cryptoInfo?.plans?.[subscribeTarget?.id || ""]?.amountAud ?? (subscribeTarget?.id === "pro" ? 49 : 299)} due
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowCryptoModal(false)}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Amount */}
            <View style={{ backgroundColor: "rgba(34,197,94,0.08)", borderWidth: 1, borderColor: "#22c55e30", borderRadius: 12, padding: 16, marginBottom: 14, alignItems: "center" }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#22c55e", letterSpacing: 0.5, marginBottom: 4 }}>AMOUNT TO SEND</Text>
              <Text style={{ fontSize: 32, fontFamily: "Inter_700Bold", color: colors.foreground, letterSpacing: -1 }}>
                A${cryptoInfo?.plans?.[subscribeTarget?.id || ""]?.amountAud ?? (subscribeTarget?.id === "pro" ? 49 : 299)}
              </Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>in USDT or USDC</Text>
            </View>

            {/* Wallet Address */}
            <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, marginBottom: 6, letterSpacing: 0.5 }}>PAYMENT ADDRESS</Text>
            <View style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: colors.foreground, letterSpacing: 0.3 }} numberOfLines={2} selectable>
                {cryptoInfo?.address ?? "0x8C117222E14DcAA20fE3087C491b1d330D0F625a"}
              </Text>
              <TouchableOpacity
                onPress={handleCopyAddress}
                style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: cryptoCopied ? "#22c55e20" : colors.card, borderRadius: 8, borderWidth: 1, borderColor: cryptoCopied ? "#22c55e50" : colors.border, minWidth: 64, alignItems: "center" }}
              >
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: cryptoCopied ? "#22c55e" : colors.foreground }}>
                  {cryptoCopied ? "Copied!" : "Copy"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Supported chains */}
            <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, marginBottom: 8, letterSpacing: 0.5 }}>SUPPORTED NETWORKS</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {(cryptoInfo?.supportedChains ?? [{ name: "Ethereum" }, { name: "Polygon" }, { name: "BSC" }, { name: "Arbitrum" }]).map((c: any) => (
                <View key={c.name} style={{ paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(59,130,246,0.08)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(59,130,246,0.2)" }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#3b82f6" }}>{c.name}</Text>
                </View>
              ))}
            </View>

            {/* Step-by-step instructions */}
            <View style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, marginBottom: 14, gap: 8 }}>
              {[
                `Send exactly A$${cryptoInfo?.plans?.[subscribeTarget?.id || ""]?.amountAud ?? (subscribeTarget?.id === "pro" ? 49 : 299)} in USDT or USDC`,
                "Use any of the supported networks above",
                `Include your email (${userEmail}) in the transaction memo/note`,
                "Your subscription activates within 24h of on-chain confirmation",
              ].map((step, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#3b82f620", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#3b82f6" }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 19 }}>{step}</Text>
                </View>
              ))}
            </View>

            {/* Support */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 }}>
              <Feather name="mail" size={13} color={colors.mutedForeground} />
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
                Need help? support@jdl.trading
              </Text>
            </View>

            <TouchableOpacity onPress={() => setShowCryptoModal(false)} style={[st.doneBtn, { backgroundColor: colors.primary }]}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>Got It</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Subscription payment method modal */}
      <Modal visible={showSubscribeModal} transparent animationType="slide" onRequestClose={() => setShowSubscribeModal(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.card }]}>
            <View style={st.modalHandle} />
            <View style={st.modalTitleRow}>
              <View>
                <Text style={[st.modalTitle, { color: colors.foreground }]}>Subscribe to {subscribeTarget?.name}</Text>
                <Text style={[{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }]}>
                  Choose your payment method
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowSubscribeModal(false)}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {subscribeError && (
              <View style={{ backgroundColor: "#ef444418", borderWidth: 1, borderColor: "#ef444430", borderRadius: 10, padding: 12, marginBottom: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <Feather name="alert-circle" size={16} color="#ef4444" style={{ marginTop: 1 }} />
                <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#ef4444", lineHeight: 18 }}>
                  {subscribeError}
                </Text>
              </View>
            )}

            {/* Option 0: Stripe Card — primary */}
            <TouchableOpacity
              style={[st.chainRow, { backgroundColor: "rgba(99,102,241,0.08)", borderColor: "#6366f130", marginBottom: 8 }]}
              onPress={handleStripeCheckout}
              disabled={subscribeLoading}
              activeOpacity={0.75}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={[st.chainIcon, { backgroundColor: "#6366f115" }]}>
                  <Feather name="credit-card" size={20} color="#6366f1" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }]}>Credit / Debit Card</Text>
                    <View style={{ backgroundColor: "#6366f120", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#818cf8", letterSpacing: 0.5 }}>STRIPE</Text>
                    </View>
                  </View>
                  <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }]}>
                    Visa, Mastercard, Amex · Instant · Secure checkout
                  </Text>
                </View>
              </View>
              {subscribeLoading ? <ActivityIndicator size="small" color="#6366f1" /> : <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
            </TouchableOpacity>

            {/* Option 1: GoCardless Recurring Monthly */}
            <TouchableOpacity
              style={[st.chainRow, { backgroundColor: "rgba(34,197,94,0.06)", borderColor: "#22c55e30", marginBottom: 8 }]}
              onPress={() => handleOpenDetails(true)}
              disabled={subscribeLoading}
              activeOpacity={0.75}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={[st.chainIcon, { backgroundColor: "#22c55e15" }]}>
                  <Feather name="repeat" size={20} color="#22c55e" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }]}>Direct Debit (Recurring)</Text>
                  <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }]}>
                    GoCardless · Auto-renews · Cancel anytime · AUD
                  </Text>
                </View>
              </View>
              {subscribeLoading ? <ActivityIndicator size="small" color="#22c55e" /> : <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
            </TouchableOpacity>

            {/* Option 2: GoCardless One Month */}
            <TouchableOpacity
              style={[st.chainRow, { backgroundColor: "rgba(168,85,247,0.06)", borderColor: "#a855f730", marginBottom: 8 }]}
              onPress={() => handleOpenDetails(false)}
              disabled={subscribeLoading}
              activeOpacity={0.75}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={[st.chainIcon, { backgroundColor: "#a855f715" }]}>
                  <Feather name="calendar" size={20} color="#a855f7" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }]}>Direct Debit (One Month)</Text>
                  <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }]}>
                    GoCardless · Single charge · Expires 30 days
                  </Text>
                </View>
              </View>
              {subscribeLoading ? <ActivityIndicator size="small" color="#a855f7" /> : <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
            </TouchableOpacity>

            {/* Option 3: Crypto */}
            <TouchableOpacity
              style={[st.chainRow, { backgroundColor: "rgba(59,130,246,0.06)", borderColor: "#3b82f630" }]}
              onPress={handleOpenCrypto}
              disabled={subscribeLoading}
              activeOpacity={0.75}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={[st.chainIcon, { backgroundColor: "#3b82f615" }]}>
                  <Feather name="zap" size={20} color="#3b82f6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }]}>Pay with Crypto</Text>
                  <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }]}>
                    USDT / USDC · Ethereum, Polygon, BSC, Arbitrum
                  </Text>
                </View>
              </View>
              {subscribeLoading ? <ActivityIndicator size="small" color="#3b82f6" /> : <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[st.doneBtn, { backgroundColor: "rgba(255,255,255,0.06)", marginTop: 12 }]}
              onPress={() => setShowSubscribeModal(false)}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  profileCard: { padding: 28, alignItems: "center" },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  avatarText: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 3, letterSpacing: -0.3 },
  profileEmail: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  badgeRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  proBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  proBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  kycBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  kycText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  profileStats: { flexDirection: "row", alignItems: "center", gap: 16, width: "100%" },
  profileStat: { flex: 1, alignItems: "center" },
  profileStatValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  profileStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  profileStatDivider: { width: 1, height: 24 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", paddingHorizontal: 20, marginTop: 28, marginBottom: 14, letterSpacing: -0.3 },
  tiersScroll: { paddingHorizontal: 20, gap: 12 },
  tierCard: { width: 210, padding: 18 },
  currentBadge: { position: "absolute", top: 12, right: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  currentBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  tierName: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 4 },
  tierPriceRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 12 },
  tierPrice: { fontSize: 30, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  tierPeriod: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tierDivider: { height: 1, marginBottom: 12 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5 },
  featureText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  upgradeBtn: { marginTop: 14, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  upgradeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  settingsList: { paddingHorizontal: 20, gap: 8 },
  settingCard: { padding: 14 },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  settingIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  settingLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  settingDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  sliderCard: { padding: 14, gap: 8 },
  sliderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sliderValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sliderWrap: { position: "relative", height: 24, justifyContent: "center" },
  sliderTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  sliderFill: { height: 6, borderRadius: 3 },
  sliderSteps: { position: "absolute", flexDirection: "row", justifyContent: "space-between", width: "100%", top: 0, bottom: 0, alignItems: "center" },
  sliderStep: { width: 20, height: 24, alignItems: "center", justifyContent: "center" },
  sliderDot: { width: 8, height: 8, borderRadius: 4 },
  sliderLabels: { flexDirection: "row", justifyContent: "space-between" },
  sliderLabelText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  chainIndicator: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  chainDot: { width: 8, height: 8, borderRadius: 4 },
  gasLimitBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  gasLimitText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 20, marginTop: 28, paddingVertical: 16, borderRadius: 14, borderWidth: 1 },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  version: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 16, marginBottom: 8 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "85%" },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", alignSelf: "center", marginBottom: 16 },
  modalTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  securityCard: { padding: 14, marginBottom: 8 },
  sessionBadge: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  chainSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  chainRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  chainIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chainName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  doneBtn: { paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 8 },
  legalText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 22, letterSpacing: 0.1 },
});
