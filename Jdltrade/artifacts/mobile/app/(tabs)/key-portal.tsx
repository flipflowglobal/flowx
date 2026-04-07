import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedEntry } from "@/components/AnimatedEntry";
import { Card } from "@/components/Card";
import { GlowDot } from "@/components/GlowDot";
import { JDLHeader } from "@/components/JDLHeader";
import { useScreenWatchdog } from "@/hooks/useScreenWatchdog";
import { StatusBadge } from "@/components/StatusBadge";
import { useColors } from "@/hooks/useColors";
import {
  getAgentWallets,
  getAgentWalletDetail,
  getSystemWalletInfo,
  generateNewWallet,
  importWalletByPrivateKey,
  recoverWalletByMnemonic,
  type AgentWalletListItem,
  type AgentWalletDetail,
} from "@/lib/api";

function statusColor(status: string): string {
  switch (status) {
    case "running": return "#22c55e";
    case "paused": return "#f59e0b";
    case "stopped": return "#6b7280";
    case "error": return "#ef4444";
    default: return "#6b7280";
  }
}

function truncateAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function copyToClipboard(text: string, label: string) {
  try {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Copied!", `${label} copied to clipboard.`);
  } catch {
    Alert.alert("Copied", text);
  }
}

interface SystemWalletData {
  address: string;
  privateKey: string;
  mnemonic: string;
  generatedAt: string;
  isNew: boolean;
}

interface GeneratedWalletData {
  address: string;
  privateKey: string;
  mnemonic: string;
}

type RecoveryMode = "privateKey" | "mnemonic";
type PortalModal = "none" | "agentDetail" | "generate" | "recover";

export default function KeyPortalScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [wallets, setWallets] = useState<AgentWalletListItem[]>([]);
  const [summary, setSummary] = useState<{ totalWallets: number; totalRevenue: number; totalSent: number; netHeld: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [systemWallet, setSystemWallet] = useState<SystemWalletData | null>(null);
  const [systemLoading, setSystemLoading] = useState(true);
  const [showSystemKey, setShowSystemKey] = useState(false);
  const [showSystemMnemonic, setShowSystemMnemonic] = useState(false);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentWalletDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);

  const [activeModal, setActiveModal] = useState<PortalModal>("none");

  const [generatedWallet, setGeneratedWallet] = useState<GeneratedWalletData | null>(null);
  const [generating, setGenerating] = useState(false);

  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>("privateKey");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveredWallet, setRecoveredWallet] = useState<GeneratedWalletData | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const loadWallets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAgentWallets();
      setWallets(data.wallets);
      setSummary(data.summary);
    } catch (err: any) {
      setError(err.message || "Failed to load agent wallets");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSystemWallet = useCallback(async () => {
    setSystemLoading(true);
    try {
      const data = await getSystemWalletInfo();
      setSystemWallet({
        address: data.address,
        privateKey: data.privateKey,
        mnemonic: data.mnemonic,
        generatedAt: data.generatedAt,
        isNew: data.isNew,
      });
    } catch {
      setSystemWallet(null);
    } finally {
      setSystemLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWallets();
    loadSystemWallet();
  }, []);

  const loadAllKeys = useCallback(async () => {
    await Promise.all([loadWallets(), loadSystemWallet()]);
  }, [loadWallets, loadSystemWallet]);

  const watchdog = useScreenWatchdog({ fetch: loadAllKeys, screenName: "Key Portal", intervalMs: 60_000 });

  const openDetail = async (agentId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedAgentId(agentId);
    setShowPrivateKey(false);
    setShowMnemonic(false);
    setDetail(null);
    setDetailLoading(true);
    setActiveModal("agentDetail");
    try {
      const d = await getAgentWalletDetail(agentId);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setActiveModal("none");
    setShowPrivateKey(false);
    setShowMnemonic(false);
    setDetail(null);
    setSelectedAgentId(null);
    setGeneratedWallet(null);
    setRecoveredWallet(null);
    setRecoveryInput("");
    setRecoveryError(null);
  };

  const openGenerate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGeneratedWallet(null);
    setGenerating(false);
    setActiveModal("generate");
  };

  const openRecover = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRecoveryMode("privateKey");
    setRecoveryInput("");
    setRecoveredWallet(null);
    setRecoveryError(null);
    setRecovering(false);
    setActiveModal("recover");
  };

  const handleGenerate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setGenerating(true);
    try {
      const res = await generateNewWallet();
      setGeneratedWallet(res.wallet);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to generate wallet");
    } finally {
      setGenerating(false);
    }
  };

  const handleRecover = async () => {
    if (!recoveryInput.trim()) {
      setRecoveryError("Please enter your " + (recoveryMode === "privateKey" ? "private key" : "recovery phrase"));
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setRecovering(true);
    setRecoveryError(null);
    setRecoveredWallet(null);
    try {
      let res: any;
      if (recoveryMode === "privateKey") {
        res = await importWalletByPrivateKey(recoveryInput.trim());
      } else {
        res = await recoverWalletByMnemonic(recoveryInput.trim());
      }
      setRecoveredWallet(res.wallet);
    } catch (err: any) {
      setRecoveryError(err.message || "Recovery failed — check your input");
    } finally {
      setRecovering(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : 120, paddingTop: topPad }}
        showsVerticalScrollIndicator={false}
      >
        <JDLHeader subtitle="Key Portal" watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }} />

        <AnimatedEntry delay={0}>
          <View style={styles.headerSection}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.portalIconWrap, { backgroundColor: "rgba(245,158,11,0.1)" }]}>
                <Feather name="key" size={20} color="#f59e0b" />
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: colors.foreground }]}>Private Key Portal</Text>
                <View style={styles.headerSubRow}>
                  <GlowDot color="#f59e0b" size={5} />
                  <Text style={[styles.headerSub, { color: "#f59e0b" }]}>Wallet Management</Text>
                </View>
              </View>
            </View>
            <Text style={[styles.headerDesc, { color: colors.mutedForeground }]}>
              Manage your system wallet and all agent wallets. View keys, generate new wallets, and recover existing ones.
            </Text>

            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "rgba(59,130,246,0.1)", borderColor: "#3b82f640" }]} onPress={openGenerate} activeOpacity={0.7}>
                <Feather name="plus-circle" size={14} color="#3b82f6" />
                <Text style={[styles.actionBtnText, { color: "#3b82f6" }]}>Generate Wallet</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "rgba(139,92,246,0.1)", borderColor: "#8b5cf640" }]} onPress={openRecover} activeOpacity={0.7}>
                <Feather name="rotate-ccw" size={14} color="#8b5cf6" />
                <Text style={[styles.actionBtnText, { color: "#8b5cf6" }]}>Recover Wallet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={60}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>System Wallet</Text>
            <View style={[styles.systemBadge, { backgroundColor: "rgba(245,158,11,0.12)" }]}>
              <Feather name="shield" size={10} color="#f59e0b" />
              <Text style={[styles.systemBadgeText, { color: "#f59e0b" }]}>Main</Text>
            </View>
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={100}>
          <Card style={styles.systemWalletCard} elevated>
            {systemLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <ActivityIndicator size="small" color="#f59e0b" />
                <Text style={[styles.loadingText, { color: colors.mutedForeground, marginTop: 8 }]}>Loading system wallet...</Text>
              </View>
            ) : systemWallet ? (
              <>
                <View style={styles.systemWalletHeader}>
                  <View style={[styles.systemWalletIcon, { backgroundColor: "rgba(245,158,11,0.12)" }]}>
                    <Feather name="cpu" size={16} color="#f59e0b" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.systemWalletTitle, { color: colors.foreground }]}>JDL System Wallet</Text>
                    <Text style={[styles.systemWalletSub, { color: colors.mutedForeground }]}>
                      Fee collection & operations · Generated {new Date(systemWallet.generatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  {systemWallet.isNew && (
                    <View style={[styles.newBadge, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
                      <Text style={[styles.newBadgeText, { color: "#22c55e" }]}>NEW</Text>
                    </View>
                  )}
                </View>

                <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border, marginBottom: 10 }]}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Address</Text>
                    <TouchableOpacity onPress={() => copyToClipboard(systemWallet.address, "Address")} style={styles.copyBtn}>
                      <Feather name="copy" size={11} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.detailValueMono, { color: colors.foreground }]} selectable>{systemWallet.address}</Text>
                </View>

                <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border, marginBottom: 8 }]}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Private Key</Text>
                    <View style={styles.rowGap}>
                      <View style={[styles.warningBadge, { backgroundColor: "rgba(239,68,68,0.1)" }]}>
                        <Feather name="alert-triangle" size={9} color="#ef4444" />
                        <Text style={[styles.warningText, { color: "#ef4444" }]}>Sensitive</Text>
                      </View>
                      {showSystemKey && (
                        <TouchableOpacity onPress={() => copyToClipboard(systemWallet.privateKey, "Private key")} style={styles.copyBtn}>
                          <Feather name="copy" size={11} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  {showSystemKey ? (
                    <Text style={[styles.detailValueMono, { color: "#f59e0b" }]} selectable>{systemWallet.privateKey}</Text>
                  ) : (
                    <Text style={[styles.detailValueMono, { color: colors.mutedForeground }]}>{"•".repeat(42)}</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.revealBtn, { backgroundColor: showSystemKey ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", marginBottom: 8 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setShowSystemKey(v => !v); }}
                  activeOpacity={0.7}
                >
                  <Feather name={showSystemKey ? "eye-off" : "eye"} size={13} color={showSystemKey ? "#ef4444" : "#f59e0b"} />
                  <Text style={[styles.revealText, { color: showSystemKey ? "#ef4444" : "#f59e0b", fontSize: 12 }]}>
                    {showSystemKey ? "Hide Private Key" : "Reveal Private Key"}
                  </Text>
                </TouchableOpacity>

                {systemWallet.mnemonic ? (
                  <>
                    <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border, marginBottom: 8 }]}>
                      <View style={styles.detailLabelRow}>
                        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Recovery Phrase</Text>
                        <View style={styles.rowGap}>
                          <View style={[styles.warningBadge, { backgroundColor: "rgba(239,68,68,0.1)" }]}>
                            <Feather name="alert-triangle" size={9} color="#ef4444" />
                            <Text style={[styles.warningText, { color: "#ef4444" }]}>Sensitive</Text>
                          </View>
                          {showSystemMnemonic && (
                            <TouchableOpacity onPress={() => copyToClipboard(systemWallet.mnemonic, "Recovery phrase")} style={styles.copyBtn}>
                              <Feather name="copy" size={11} color={colors.mutedForeground} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                      {showSystemMnemonic ? (
                        <Text style={[styles.detailValueMono, { color: "#f59e0b", lineHeight: 22 }]} selectable>{systemWallet.mnemonic}</Text>
                      ) : (
                        <Text style={[styles.detailValueMono, { color: colors.mutedForeground }]}>{"•".repeat(60)}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[styles.revealBtn, { backgroundColor: showSystemMnemonic ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", marginBottom: 8 }]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setShowSystemMnemonic(v => !v); }}
                      activeOpacity={0.7}
                    >
                      <Feather name={showSystemMnemonic ? "eye-off" : "eye"} size={13} color={showSystemMnemonic ? "#ef4444" : "#f59e0b"} />
                      <Text style={[styles.revealText, { color: showSystemMnemonic ? "#ef4444" : "#f59e0b", fontSize: 12 }]}>
                        {showSystemMnemonic ? "Hide Recovery Phrase" : "Reveal Recovery Phrase"}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                {systemWallet.isNew && (
                  <View style={[styles.newWalletWarning, { backgroundColor: "rgba(245,158,11,0.08)", borderColor: "#f59e0b30" }]}>
                    <Feather name="alert-circle" size={13} color="#f59e0b" />
                    <Text style={[styles.newWalletWarningText, { color: "#f59e0b" }]}>
                      New wallet generated! Set SYSTEM_WALLET_PRIVATE_KEY in Secrets to persist across restarts.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <Feather name="alert-circle" size={20} color="#ef4444" />
                <Text style={[styles.loadingText, { color: "#ef4444", marginTop: 8 }]}>Unable to load system wallet</Text>
              </View>
            )}
          </Card>
        </AnimatedEntry>

        {summary && (
          <AnimatedEntry delay={140}>
            <Card style={styles.summaryCard} elevated>
              <View style={styles.summaryRow}>
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: colors.foreground }]}>{summary.totalWallets}</Text>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Agent Wallets</Text>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: "#22c55e" }]}>${summary.totalRevenue.toLocaleString()}</Text>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Revenue</Text>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: colors.foreground }]}>${summary.netHeld.toLocaleString()}</Text>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Net Held</Text>
                </View>
              </View>
            </Card>
          </AnimatedEntry>
        )}

        {loading && (
          <View style={styles.loadingSection}>
            <ActivityIndicator size="large" color="#f59e0b" />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading agent wallets...</Text>
          </View>
        )}

        {error && (
          <AnimatedEntry delay={100}>
            <View style={[styles.errorBanner, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "#ef444430" }]}>
              <Feather name="alert-circle" size={14} color="#ef4444" />
              <Text style={[styles.errorText, { color: "#ef4444" }]}>{error}</Text>
              <TouchableOpacity onPress={loadWallets}><Text style={{ color: colors.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>Retry</Text></TouchableOpacity>
            </View>
          </AnimatedEntry>
        )}

        {!loading && wallets.length > 0 && (
          <AnimatedEntry delay={200}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Agent Wallets</Text>
              <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>{wallets.length} active</Text>
            </View>
          </AnimatedEntry>
        )}

        {wallets.map((w, i) => (
          <AnimatedEntry key={w.agentId} delay={240 + i * 60}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => openDetail(w.agentId)}>
              <Card style={styles.walletCard}>
                <View style={styles.walletHeader}>
                  <View style={styles.walletHeaderLeft}>
                    <View style={[styles.agentDot, { backgroundColor: statusColor(w.agentStatus) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.agentName, { color: colors.foreground }]} numberOfLines={1}>{w.agentName}</Text>
                      <Text style={[styles.agentStrategy, { color: colors.mutedForeground }]}>{w.strategy}</Text>
                    </View>
                  </View>
                  <StatusBadge status={w.agentStatus as "running" | "paused" | "stopped" | "error"} />
                </View>

                <View style={[styles.walletAddressRow, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                  <Feather name="hash" size={12} color="#f59e0b" />
                  <Text style={[styles.walletAddress, { color: colors.foreground }]}>{truncateAddr(w.wallet.address)}</Text>
                  <View style={styles.walletAddressFull}>
                    <Text style={[styles.walletAddressSmall, { color: colors.mutedForeground }]}>{w.wallet.address}</Text>
                  </View>
                </View>

                <View style={styles.walletMetrics}>
                  <View style={styles.walletMetric}>
                    <Text style={[styles.wmLabel, { color: colors.mutedForeground }]}>Received</Text>
                    <Text style={[styles.wmValue, { color: "#22c55e" }]}>${w.wallet.totalReceived.toLocaleString()}</Text>
                  </View>
                  <View style={styles.walletMetric}>
                    <Text style={[styles.wmLabel, { color: colors.mutedForeground }]}>Sent</Text>
                    <Text style={[styles.wmValue, { color: "#ef4444" }]}>${w.wallet.totalSent.toLocaleString()}</Text>
                  </View>
                  <View style={styles.walletMetric}>
                    <Text style={[styles.wmLabel, { color: colors.mutedForeground }]}>Net</Text>
                    <Text style={[styles.wmValue, { color: w.wallet.netRevenue >= 0 ? "#22c55e" : "#ef4444" }]}>${w.wallet.netRevenue.toLocaleString()}</Text>
                  </View>
                  <View style={styles.walletMetric}>
                    <Text style={[styles.wmLabel, { color: colors.mutedForeground }]}>Txs</Text>
                    <Text style={[styles.wmValue, { color: colors.foreground }]}>{w.wallet.txCount}</Text>
                  </View>
                </View>

                <View style={[styles.viewKeyRow, { backgroundColor: "rgba(245,158,11,0.06)" }]}>
                  <Feather name="eye" size={12} color="#f59e0b" />
                  <Text style={[styles.viewKeyText, { color: "#f59e0b" }]}>Tap to view private key & details</Text>
                  <Feather name="chevron-right" size={14} color="#f59e0b" />
                </View>
              </Card>
            </TouchableOpacity>
          </AnimatedEntry>
        ))}

        <AnimatedEntry delay={600}>
          <View style={[styles.securityNote, { borderColor: colors.border }]}>
            <Feather name="shield" size={14} color="#f59e0b" />
            <Text style={[styles.securityText, { color: colors.mutedForeground }]}>
              Private keys are stored securely in-app. Never share your private key or recovery phrase with anyone. JDL staff will never ask for your keys.
            </Text>
          </View>
        </AnimatedEntry>
      </ScrollView>

      <Modal visible={activeModal === "agentDetail"} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {detail ? detail.agentName : "Loading..."}
              </Text>
              <TouchableOpacity onPress={closeModal} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {detailLoading && (
              <View style={{ paddingVertical: 40, alignItems: "center" }}>
                <ActivityIndicator size="large" color="#f59e0b" />
              </View>
            )}

            {detail && (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
                <View style={styles.detailSection}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Wallet Address</Text>
                    <TouchableOpacity onPress={() => copyToClipboard(detail.wallet.address, "Address")} style={styles.copyBtn}>
                      <Feather name="copy" size={11} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                    <Text style={[styles.detailValueMono, { color: colors.foreground }]} selectable>{detail.wallet.address}</Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Private Key</Text>
                    <View style={[styles.warningBadge, { backgroundColor: "rgba(239,68,68,0.1)" }]}>
                      <Feather name="alert-triangle" size={10} color="#ef4444" />
                      <Text style={[styles.warningText, { color: "#ef4444" }]}>Sensitive</Text>
                    </View>
                  </View>
                  <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                    {showPrivateKey ? (
                      <Text style={[styles.detailValueMono, { color: "#f59e0b" }]} selectable>{detail.wallet.privateKey}</Text>
                    ) : (
                      <Text style={[styles.detailValueMono, { color: colors.mutedForeground }]}>{"•".repeat(42)}</Text>
                    )}
                  </View>
                  <TouchableOpacity style={[styles.revealBtn, { backgroundColor: showPrivateKey ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)" }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setShowPrivateKey(v => !v); }} activeOpacity={0.7}>
                    <Feather name={showPrivateKey ? "eye-off" : "eye"} size={14} color={showPrivateKey ? "#ef4444" : "#f59e0b"} />
                    <Text style={[styles.revealText, { color: showPrivateKey ? "#ef4444" : "#f59e0b" }]}>
                      {showPrivateKey ? "Hide Key" : "View Now"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Recovery Phrase</Text>
                    <View style={[styles.warningBadge, { backgroundColor: "rgba(239,68,68,0.1)" }]}>
                      <Feather name="alert-triangle" size={10} color="#ef4444" />
                      <Text style={[styles.warningText, { color: "#ef4444" }]}>Sensitive</Text>
                    </View>
                  </View>
                  <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                    {showMnemonic ? (
                      <Text style={[styles.detailValueMono, { color: "#f59e0b" }]} selectable>{detail.wallet.mnemonic}</Text>
                    ) : (
                      <Text style={[styles.detailValueMono, { color: colors.mutedForeground }]}>{"•".repeat(48)}</Text>
                    )}
                  </View>
                  <TouchableOpacity style={[styles.revealBtn, { backgroundColor: showMnemonic ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)" }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setShowMnemonic(v => !v); }} activeOpacity={0.7}>
                    <Feather name={showMnemonic ? "eye-off" : "eye"} size={14} color={showMnemonic ? "#ef4444" : "#f59e0b"} />
                    <Text style={[styles.revealText, { color: showMnemonic ? "#ef4444" : "#f59e0b" }]}>
                      {showMnemonic ? "Hide Phrase" : "View Now"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Revenue Summary</Text>
                  <View style={styles.revSummaryRow}>
                    <View style={styles.revSummaryItem}>
                      <Text style={[styles.revSummaryVal, { color: "#22c55e" }]}>${detail.wallet.totalReceived.toLocaleString()}</Text>
                      <Text style={[styles.revSummaryLbl, { color: colors.mutedForeground }]}>Received</Text>
                    </View>
                    <View style={[styles.revSummaryDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.revSummaryItem}>
                      <Text style={[styles.revSummaryVal, { color: "#ef4444" }]}>${detail.wallet.totalSent.toLocaleString()}</Text>
                      <Text style={[styles.revSummaryLbl, { color: colors.mutedForeground }]}>Sent</Text>
                    </View>
                    <View style={[styles.revSummaryDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.revSummaryItem}>
                      <Text style={[styles.revSummaryVal, { color: detail.wallet.netRevenue >= 0 ? "#22c55e" : "#ef4444" }]}>${detail.wallet.netRevenue.toLocaleString()}</Text>
                      <Text style={[styles.revSummaryLbl, { color: colors.mutedForeground }]}>Net</Text>
                    </View>
                  </View>
                </View>

                {detail.wallet.txHistory.length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Transaction History</Text>
                    {detail.wallet.txHistory.map((tx, idx) => (
                      <View key={idx} style={[styles.txRow, { borderColor: colors.border }]}>
                        <View style={[styles.txIcon, { backgroundColor: tx.type === "receive" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)" }]}>
                          <Feather name={tx.type === "receive" ? "arrow-down-left" : "arrow-up-right"} size={14} color={tx.type === "receive" ? "#22c55e" : "#ef4444"} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.txType, { color: colors.foreground }]}>{tx.type === "receive" ? "Received" : "Sent"}</Text>
                          <Text style={[styles.txAddr, { color: colors.mutedForeground }]}>{tx.type === "receive" ? `From: ${truncateAddr(tx.from || "")}` : `To: ${truncateAddr(tx.to || "")}`}</Text>
                          <Text style={[styles.txHash, { color: colors.mutedForeground }]}>Tx: {truncateAddr(tx.txHash)}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[styles.txAmount, { color: tx.type === "receive" ? "#22c55e" : "#ef4444" }]}>
                            {tx.type === "receive" ? "+" : "-"}${tx.amount.toLocaleString()}
                          </Text>
                          <Text style={[styles.txChain, { color: colors.mutedForeground }]}>{tx.chain}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                <View style={[styles.detailSection, { marginBottom: 20 }]}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Wallet Created</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>{new Date(detail.wallet.createdAt).toLocaleString()}</Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={activeModal === "generate"} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Feather name="plus-circle" size={18} color="#3b82f6" />
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Generate New Wallet</Text>
              </View>
              <TouchableOpacity onPress={closeModal} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {!generatedWallet ? (
              <View style={{ paddingBottom: 20 }}>
                <Text style={[styles.recoveryDesc, { color: colors.mutedForeground }]}>
                  Generate a brand new Ethereum-compatible wallet with a real private key and 12-word recovery phrase. Store the keys safely after generating.
                </Text>
                <View style={[styles.infoBox, { backgroundColor: "rgba(59,130,246,0.06)", borderColor: "#3b82f620" }]}>
                  <Feather name="info" size={14} color="#3b82f6" />
                  <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                    This wallet is generated using cryptographically secure randomness. The private key is only shown once — save it immediately.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: "#3b82f6" }]}
                  onPress={handleGenerate}
                  activeOpacity={0.8}
                  disabled={generating}
                >
                  {generating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name="zap" size={15} color="#fff" />
                      <Text style={styles.primaryBtnText}>Generate Wallet</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
                <View style={[styles.successBanner, { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "#22c55e30" }]}>
                  <Feather name="check-circle" size={16} color="#22c55e" />
                  <Text style={[styles.successText, { color: "#22c55e" }]}>Wallet generated successfully!</Text>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Address</Text>
                    <TouchableOpacity onPress={() => copyToClipboard(generatedWallet.address, "Address")} style={styles.copyBtn}>
                      <Feather name="copy" size={11} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                    <Text style={[styles.detailValueMono, { color: colors.foreground }]} selectable>{generatedWallet.address}</Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Private Key</Text>
                    <View style={styles.rowGap}>
                      <View style={[styles.warningBadge, { backgroundColor: "rgba(239,68,68,0.1)" }]}>
                        <Feather name="alert-triangle" size={9} color="#ef4444" />
                        <Text style={[styles.warningText, { color: "#ef4444" }]}>Save Now</Text>
                      </View>
                      <TouchableOpacity onPress={() => copyToClipboard(generatedWallet.privateKey, "Private key")} style={styles.copyBtn}>
                        <Feather name="copy" size={11} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                    <Text style={[styles.detailValueMono, { color: "#f59e0b" }]} selectable>{generatedWallet.privateKey}</Text>
                  </View>
                </View>

                {generatedWallet.mnemonic && (
                  <View style={[styles.detailSection, { marginBottom: 20 }]}>
                    <View style={styles.detailLabelRow}>
                      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Recovery Phrase (12 words)</Text>
                      <TouchableOpacity onPress={() => copyToClipboard(generatedWallet.mnemonic, "Recovery phrase")} style={styles.copyBtn}>
                        <Feather name="copy" size={11} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </View>
                    <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                      <Text style={[styles.detailValueMono, { color: "#f59e0b", lineHeight: 22 }]} selectable>{generatedWallet.mnemonic}</Text>
                    </View>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={activeModal === "recover"} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Feather name="rotate-ccw" size={18} color="#8b5cf6" />
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Recover Wallet</Text>
              </View>
              <TouchableOpacity onPress={closeModal} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabBtn, recoveryMode === "privateKey" && { backgroundColor: "rgba(139,92,246,0.12)", borderColor: "#8b5cf640" }]}
                onPress={() => { setRecoveryMode("privateKey"); setRecoveredWallet(null); setRecoveryError(null); setRecoveryInput(""); }}
                activeOpacity={0.7}
              >
                <Feather name="key" size={12} color={recoveryMode === "privateKey" ? "#8b5cf6" : colors.mutedForeground} />
                <Text style={[styles.tabBtnText, { color: recoveryMode === "privateKey" ? "#8b5cf6" : colors.mutedForeground }]}>Private Key</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, recoveryMode === "mnemonic" && { backgroundColor: "rgba(139,92,246,0.12)", borderColor: "#8b5cf640" }]}
                onPress={() => { setRecoveryMode("mnemonic"); setRecoveredWallet(null); setRecoveryError(null); setRecoveryInput(""); }}
                activeOpacity={0.7}
              >
                <Feather name="file-text" size={12} color={recoveryMode === "mnemonic" ? "#8b5cf6" : colors.mutedForeground} />
                <Text style={[styles.tabBtnText, { color: recoveryMode === "mnemonic" ? "#8b5cf6" : colors.mutedForeground }]}>Recovery Phrase</Text>
              </TouchableOpacity>
            </View>

            {!recoveredWallet ? (
              <View style={{ paddingBottom: 12 }}>
                <Text style={[styles.recoveryDesc, { color: colors.mutedForeground }]}>
                  {recoveryMode === "privateKey"
                    ? "Enter your wallet's private key (64 hex characters starting with 0x) to recover the wallet address and details."
                    : "Enter your 12 or 24-word recovery phrase with words separated by spaces to recover your wallet."}
                </Text>

                <TextInput
                  style={[styles.recoveryInput, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: recoveryError ? "#ef4444" : colors.border, color: colors.foreground }]}
                  placeholder={recoveryMode === "privateKey" ? "0x..." : "word1 word2 word3 ..."}
                  placeholderTextColor={colors.mutedForeground}
                  value={recoveryInput}
                  onChangeText={(t) => { setRecoveryInput(t); setRecoveryError(null); }}
                  multiline={recoveryMode === "mnemonic"}
                  numberOfLines={recoveryMode === "mnemonic" ? 4 : 1}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={recoveryMode === "privateKey"}
                />

                {recoveryError && (
                  <View style={[styles.errorBanner, { marginHorizontal: 0, backgroundColor: "rgba(239,68,68,0.08)", borderColor: "#ef444430", marginBottom: 10, marginTop: 4 }]}>
                    <Feather name="alert-circle" size={12} color="#ef4444" />
                    <Text style={[styles.errorText, { color: "#ef4444" }]}>{recoveryError}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: "#8b5cf6" }]}
                  onPress={handleRecover}
                  activeOpacity={0.8}
                  disabled={recovering}
                >
                  {recovering ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name="unlock" size={15} color="#fff" />
                      <Text style={styles.primaryBtnText}>Recover Wallet</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
                <View style={[styles.successBanner, { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "#22c55e30", marginBottom: 12 }]}>
                  <Feather name="check-circle" size={16} color="#22c55e" />
                  <Text style={[styles.successText, { color: "#22c55e" }]}>Wallet recovered successfully!</Text>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Address</Text>
                    <TouchableOpacity onPress={() => copyToClipboard(recoveredWallet.address, "Address")} style={styles.copyBtn}>
                      <Feather name="copy" size={11} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                    <Text style={[styles.detailValueMono, { color: colors.foreground }]} selectable>{recoveredWallet.address}</Text>
                  </View>
                </View>

                <View style={[styles.detailSection, { marginBottom: 20 }]}>
                  <View style={styles.detailLabelRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Private Key</Text>
                    <TouchableOpacity onPress={() => copyToClipboard(recoveredWallet.privateKey, "Private key")} style={styles.copyBtn}>
                      <Feather name="copy" size={11} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.detailValueBox, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border }]}>
                    <Text style={[styles.detailValueMono, { color: "#f59e0b" }]} selectable>{recoveredWallet.privateKey}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: "#8b5cf650" }]}
                  onPress={() => { setRecoveredWallet(null); setRecoveryInput(""); setRecoveryError(null); }}
                  activeOpacity={0.7}
                >
                  <Feather name="rotate-ccw" size={14} color="#8b5cf6" />
                  <Text style={[styles.secondaryBtnText, { color: "#8b5cf6" }]}>Recover Another</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerSection: { paddingHorizontal: 20, paddingTop: 16, marginBottom: 16 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  portalIconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  headerSubRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  headerSub: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  headerDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 14 },
  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  actionBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sectionSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  systemBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  systemBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  systemWalletCard: { marginHorizontal: 20, padding: 16, marginBottom: 16 },
  systemWalletHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  systemWalletIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  systemWalletTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  systemWalletSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  newBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  newBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  newWalletWarning: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  newWalletWarningText: { fontSize: 11, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 16 },
  summaryCard: { marginHorizontal: 20, padding: 16, marginBottom: 16 },
  summaryRow: { flexDirection: "row" },
  summaryMetric: { flex: 1, alignItems: "center" },
  summaryValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  summaryDivider: { width: 1, height: "80%" as any, alignSelf: "center" },
  loadingSection: { alignItems: "center", paddingTop: 40, gap: 12 },
  loadingText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  errorBanner: { marginHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16 },
  errorText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  walletCard: { marginHorizontal: 20, padding: 16, marginBottom: 10 },
  walletHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  walletHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  agentDot: { width: 8, height: 8, borderRadius: 4 },
  agentName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  agentStrategy: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  walletAddressRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  walletAddress: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  walletAddressFull: { flex: 1 },
  walletAddressSmall: { fontSize: 9, fontFamily: "Inter_400Regular" },
  walletMetrics: { flexDirection: "row", marginBottom: 10 },
  walletMetric: { flex: 1, alignItems: "center" },
  wmLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  wmValue: { fontSize: 14, fontFamily: "Inter_700Bold", marginTop: 2 },
  viewKeyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 10, borderRadius: 8 },
  viewKeyText: { fontSize: 12, fontFamily: "Inter_600SemiBold", flex: 1 },
  securityNote: { marginHorizontal: 20, flexDirection: "row", gap: 10, padding: 14, borderRadius: 10, borderWidth: 1, marginTop: 8, marginBottom: 20 },
  securityText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%" as any },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", alignSelf: "center", marginBottom: 16 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalClose: { padding: 4 },
  tabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  tabBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  recoveryDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 12 },
  recoveryInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12, minHeight: 46 },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16 },
  infoText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, marginBottom: 8 },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  successBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16 },
  successText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  detailSection: { marginBottom: 16 },
  detailLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  detailLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  detailValueBox: { padding: 12, borderRadius: 10, borderWidth: 1 },
  detailValueMono: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  detailValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  warningBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  warningText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  copyBtn: { padding: 4 },
  rowGap: { flexDirection: "row", alignItems: "center", gap: 6 },
  revealBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 10, borderRadius: 8, marginTop: 8 },
  revealText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  revSummaryRow: { flexDirection: "row" },
  revSummaryItem: { flex: 1, alignItems: "center" },
  revSummaryVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  revSummaryLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  revSummaryDivider: { width: 1, height: "80%" as any, alignSelf: "center" },
  txRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  txIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  txType: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  txAddr: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  txHash: { fontSize: 9, fontFamily: "Inter_400Regular", marginTop: 1 },
  txAmount: { fontSize: 14, fontFamily: "Inter_700Bold" },
  txChain: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
});
