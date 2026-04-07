import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedEntry } from "@/components/AnimatedEntry";
import { Card } from "@/components/Card";
import { ChainBadge } from "@/components/ChainBadge";
import { JDLHeader } from "@/components/JDLHeader";
import { useScreenWatchdog } from "@/hooks/useScreenWatchdog";
import { GlowDot } from "@/components/GlowDot";
import { StatusBadge } from "@/components/StatusBadge";
import { useColors } from "@/hooks/useColors";
import {
  getFlashLoanOpportunities,
  getFlashLoanStats,
  simulateFlashLoan,
  executeFlashLoan,
  getFlashLoanHistory,
  getMarketFxRates,
  type FlashLoanOpportunity,
  type FlashLoanStats,
  type FlashLoanExecution,
} from "@/lib/api";
import { formatAUD, DEFAULT_USD_TO_AUD } from "@/lib/currency";

type SimState = "idle" | "simulating" | "ready" | "executing";

export default function FlashLoansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opportunities, setOpportunities] = useState<FlashLoanOpportunity[]>([]);
  const [stats, setStats] = useState<FlashLoanStats | null>(null);
  const [history, setHistory] = useState<FlashLoanExecution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [audRate, setAudRate] = useState(DEFAULT_USD_TO_AUD);
  const formatCurrency = (val: number) => formatAUD(val, audRate);

  const [selectedOpp, setSelectedOpp] = useState<FlashLoanOpportunity | null>(null);
  const [simState, setSimState] = useState<SimState>("idle");
  const [simResult, setSimResult] = useState<{
    profitEstimate: number;
    netProfitEstimate: number;
    premiumEstimate: number;
    gasEstimateUsd: number;
    gasEstimate: number;
    slippage: number;
    contractDeployed: boolean;
  } | null>(null);
  const [lastExecution, setLastExecution] = useState<FlashLoanExecution | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const [oppRes, statsRes, histRes, fxRes] = await Promise.all([
        getFlashLoanOpportunities(),
        getFlashLoanStats(),
        getFlashLoanHistory(),
        getMarketFxRates().catch(() => null),
      ]);
      if (fxRes?.usdToAud) setAudRate(fxRes.usdToAud);
      setOpportunities(oppRes.opportunities);
      setStats(statsRes);
      setHistory(histRes.executions.slice(0, 5));
    } catch (err: any) {
      setError(err.message || "Failed to load flash loan data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, []);

  const watchdog = useScreenWatchdog({ fetch: fetchAll, screenName: "Flash Loans", intervalMs: 45_000 });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const openOpportunity = (opp: FlashLoanOpportunity) => {
    setSelectedOpp(opp);
    setSimState("idle");
    setSimResult(null);
    setLastExecution(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const runSimulation = async () => {
    if (!selectedOpp) return;
    setSimState("simulating");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await simulateFlashLoan(selectedOpp.id);
      if (res.success) {
        setSimResult({
          profitEstimate: res.simulation.profitEstimate,
          netProfitEstimate: res.simulation.netProfitEstimate,
          premiumEstimate: res.simulation.premiumEstimate,
          gasEstimateUsd: res.simulation.gasEstimateUsd,
          gasEstimate: res.simulation.gasEstimate,
          slippage: res.simulation.slippage,
          contractDeployed: res.simulation.contractDeployed,
        });
        setSimState("ready");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setSimState("idle");
        Alert.alert("Simulation Failed", res.simulation.revertReason || "Simulation reverted");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      setSimState("idle");
      Alert.alert("Simulation Error", "Failed to run simulation");
    }
  };

  const executeLoan = async () => {
    if (!selectedOpp) return;
    setSimState("executing");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const res = await executeFlashLoan({
        opportunityId: selectedOpp.id,
        loanAmount: selectedOpp.loanAmount,
        route: selectedOpp.route,
        chain: selectedOpp.chain || "arbitrum",
        slippageTolerance: 0.5,
      });
      setLastExecution(res);
      setSimState("idle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await fetchAll();
      const isLive = !res.paperTrade && res.txHash;
      const chain = res.chain || selectedOpp.chain || "arbitrum";
      Alert.alert(
        isLive ? "⚡ Flash Loan Executed On-Chain ✓" : "📄 Paper Trade Executed ✓",
        [
          `Chain: ${chain.charAt(0).toUpperCase() + chain.slice(1)}`,
          `Loan: ${formatCurrency(res.loanAmount)}`,
          `Gross Profit: ${formatCurrency(res.grossProfit)}`,
          `Aave Premium: -${formatCurrency(res.premiumPaid)}`,
          `Gas Cost: -${formatCurrency(res.gasCostUsd)}`,
          `Net Profit: ${formatCurrency(res.netProfit)}`,
          isLive ? `\nTx: ${res.txHash?.slice(0, 20)}...` : "\n⚠️ Paper trade — fund system wallet for live execution",
        ].join("\n")
      );
    } catch (err: any) {
      setSimState("ready");
      Alert.alert("Execution Failed", err.message || "Transaction reverted");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const closeModal = () => {
    if (simState === "simulating" || simState === "executing") return;
    setSelectedOpp(null);
    setSimState("idle");
    setSimResult(null);
  };

  const totalProfit = opportunities.reduce((s, o) => s + o.netProfit, 0);
  const profitableCount = opportunities.filter((o) => o.netProfit > 0).length;

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading opportunities...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : 100, paddingTop: topPad }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <JDLHeader subtitle="Flash Loans" watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }} />

        <AnimatedEntry delay={0}>
          <View style={[styles.simModeBanner, { backgroundColor: "rgba(139,92,246,0.08)", borderColor: "#8b5cf630" }]}>
            <Feather name="zap-off" size={13} color="#8b5cf6" />
            <Text style={[styles.simModeText, { color: "#8b5cf6" }]}>
              Paper Trading Mode — Algorithms run on real-time DEX data. No real capital deployed.
            </Text>
          </View>
        </AnimatedEntry>

        {error && (
          <AnimatedEntry delay={0}>
            <View style={[styles.errorBanner, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "#ef444430" }]}>
              <Feather name="alert-circle" size={14} color="#ef4444" />
              <Text style={[styles.errorText, { color: "#ef4444" }]}>{error}</Text>
              <TouchableOpacity onPress={fetchAll} activeOpacity={0.7}>
                <Text style={{ color: colors.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>Retry</Text>
              </TouchableOpacity>
            </View>
          </AnimatedEntry>
        )}

        <AnimatedEntry delay={0}>
          <View style={styles.summaryRow}>
            <Card style={styles.summaryCard} elevated>
              <View style={styles.summaryTop}>
                <View style={[styles.summaryIconWrap, { backgroundColor: "#f59e0b15" }]}>
                  <Feather name="zap" size={16} color="#f59e0b" />
                </View>
                <GlowDot color="#22c55e" size={6} />
              </View>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{profitableCount}</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Live Opportunities</Text>
            </Card>
            <Card style={styles.summaryCard} elevated>
              <View style={styles.summaryTop}>
                <View style={[styles.summaryIconWrap, { backgroundColor: "#22c55e15" }]}>
                  <Feather name="dollar-sign" size={16} color="#22c55e" />
                </View>
              </View>
              <Text style={[styles.summaryValue, { color: colors.profit }]}>{formatCurrency(totalProfit)}</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Est. Total Profit</Text>
            </Card>
          </View>
        </AnimatedEntry>

        {stats && (
          <AnimatedEntry delay={60}>
            <Card style={styles.statsCard} elevated>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.profit }]}>{formatCurrency(stats.totalProfit30d)}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>30d Profit</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.foreground }]}>{stats.totalCount30d}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Executions</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.primary }]}>{(stats.successRate * 100).toFixed(1)}%</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Success Rate</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.foreground }]}>{formatCurrency(stats.avgNetProfit)}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Avg Net</Text>
                </View>
              </View>
            </Card>
          </AnimatedEntry>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Live Opportunities</Text>
          <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>Tap to simulate & execute</Text>
        </View>

        <View style={styles.list}>
          {opportunities.length === 0 && !error && (
            <AnimatedEntry delay={100}>
              <Card style={{ padding: 24, alignItems: "center" }}>
                <Feather name="zap-off" size={28} color={colors.mutedForeground} />
                <Text style={[{ color: colors.mutedForeground, fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 12 }]}>
                  No profitable opportunities right now
                </Text>
                <Text style={[{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 }]}>
                  Pull to refresh
                </Text>
              </Card>
            </AnimatedEntry>
          )}

          {opportunities.map((opp, i) => (
            <AnimatedEntry key={opp.id} delay={100 + i * 80}>
              <Card
                style={styles.oppCard}
                elevated
                onPress={() => openOpportunity(opp)}
              >
                <View style={styles.oppHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.oppRoute, { color: colors.foreground }]}>
                      {opp.route.join(" → ")}
                    </Text>
                    <View style={styles.dexRow}>
                      {opp.dexs.map((d, di) => (
                        <View key={d} style={styles.dexRow}>
                          {di > 0 && <Feather name="arrow-right" size={9} color={colors.primary} />}
                          <Text style={[styles.dexName, { color: colors.mutedForeground }]}>{d}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <View style={[styles.networkBadge, { backgroundColor: opp.network === "Arbitrum" ? "#28a0f015" : "#627eea15" }]}>
                    <Text style={[styles.networkText, { color: opp.network === "Arbitrum" ? "#28a0f0" : "#627eea" }]}>{opp.network}</Text>
                  </View>
                </View>

                <View style={[styles.oppStats, { backgroundColor: "rgba(255,255,255,0.02)" }]}>
                  <View style={styles.oppStat}>
                    <Text style={[styles.oppStatLabel, { color: colors.mutedForeground }]}>Spread</Text>
                    <Text style={[styles.oppStatValue, { color: colors.primary }]}>{opp.spreadPct}%</Text>
                  </View>
                  <View style={styles.oppStat}>
                    <Text style={[styles.oppStatLabel, { color: colors.mutedForeground }]}>Loan</Text>
                    <Text style={[styles.oppStatValue, { color: colors.foreground }]}>{formatCurrency(opp.loanAmount)}</Text>
                  </View>
                  <View style={styles.oppStat}>
                    <Text style={[styles.oppStatLabel, { color: colors.mutedForeground }]}>Net Profit</Text>
                    <Text style={[styles.oppStatValue, { color: opp.netProfit > 0 ? colors.profit : colors.loss }]}>
                      {formatCurrency(opp.netProfit)}
                    </Text>
                  </View>
                  <View style={styles.oppStat}>
                    <Text style={[styles.oppStatLabel, { color: colors.mutedForeground }]}>Confidence</Text>
                    <Text style={[styles.oppStatValue, { color: opp.confidence > 0.85 ? colors.profit : "#f59e0b" }]}>
                      {(opp.confidence * 100).toFixed(0)}%
                    </Text>
                  </View>
                </View>

                <View style={styles.oppFooter}>
                  <View style={styles.footerLeft}>
                    <Feather name="clock" size={11} color={colors.mutedForeground} />
                    <Text style={[styles.expiryText, { color: opp.expiresIn < 10 ? "#ef4444" : colors.mutedForeground }]}>
                      {opp.expiresIn}s
                    </Text>
                  </View>
                  <View style={[styles.executeHint, { backgroundColor: colors.primary + "15" }]}>
                    <Feather name="zap" size={10} color={colors.primary} />
                    <Text style={[styles.executeHintText, { color: colors.primary }]}>Simulate & Execute</Text>
                  </View>
                </View>
              </Card>
            </AnimatedEntry>
          ))}
        </View>

        {history.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { marginTop: 8 }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Executions</Text>
              <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>{history.length} recent</Text>
            </View>
            {history.map((exec, i) => (
              <AnimatedEntry key={exec.id} delay={i * 60}>
                <Card style={styles.histCard}>
                  <View style={styles.histRow}>
                    <View style={[styles.histIcon, { backgroundColor: exec.status === "success" ? "#22c55e15" : "#ef444415" }]}>
                      <Feather
                        name={exec.status === "success" ? "check-circle" : "x-circle"}
                        size={14}
                        color={exec.status === "success" ? "#22c55e" : "#ef4444"}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.histRoute, { color: colors.foreground }]} numberOfLines={1}>
                        {exec.route.join(" → ")}
                      </Text>
                      <Text style={[styles.histTx, { color: colors.mutedForeground }]}>
                        {exec.txHash ? exec.txHash.slice(0, 18) + "..." : "Paper Trade · No on-chain tx"}
                      </Text>
                    </View>
                    <Text style={[styles.histProfit, { color: exec.netProfit > 0 ? colors.profit : colors.loss }]}>
                      {formatCurrency(exec.netProfit)}
                    </Text>
                  </View>
                </Card>
              </AnimatedEntry>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={!!selectedOpp} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Flash Loan Execution</Text>

            {selectedOpp && (
              <>
                <View style={[styles.modalRouteSection, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.modalRouteText, { color: colors.foreground }]}>
                    {selectedOpp.route.join(" → ")}
                  </Text>
                  <Text style={[styles.modalDexes, { color: colors.mutedForeground }]}>
                    via {selectedOpp.dexs.join(" · ")}
                  </Text>
                </View>

                <View style={styles.modalDetails}>
                  {[
                    { label: "Loan Amount", value: formatCurrency(selectedOpp.loanAmount), color: colors.foreground },
                    { label: "Spread", value: `${selectedOpp.spreadPct}%`, color: colors.primary },
                    { label: "Est. Profit", value: formatCurrency(selectedOpp.estimatedProfit), color: colors.foreground },
                    { label: "Gas Cost", value: formatCurrency(selectedOpp.gasCost), color: colors.loss },
                    { label: "Net Profit", value: formatCurrency(selectedOpp.netProfit), color: colors.profit },
                    { label: "Confidence", value: `${(selectedOpp.confidence * 100).toFixed(0)}%`, color: colors.foreground },
                    { label: "Network", value: selectedOpp.network, color: colors.foreground },
                  ].map(({ label, value, color }) => (
                    <View key={label} style={styles.modalDetailRow}>
                      <Text style={[styles.modalDetailLabel, { color: colors.mutedForeground }]}>{label}</Text>
                      <Text style={[styles.modalDetailValue, { color }]}>{value}</Text>
                    </View>
                  ))}
                </View>

                {simResult && (
                  <View style={[styles.simResult, { backgroundColor: "rgba(34,197,94,0.06)", borderColor: "#22c55e30" }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <Text style={[styles.simTitle, { color: "#22c55e" }]}>Simulation Result</Text>
                      <Text style={{ fontSize: 10, color: simResult.contractDeployed ? "#22c55e" : "#f59e0b" }}>
                        {simResult.contractDeployed ? "Contract Ready" : "Paper Mode"}
                      </Text>
                    </View>
                    <View style={styles.simRow}>
                      <Text style={[styles.simLabel, { color: colors.mutedForeground }]}>Gross Profit</Text>
                      <Text style={[styles.simValue, { color: colors.foreground }]}>{formatCurrency(simResult.profitEstimate)}</Text>
                    </View>
                    <View style={styles.simRow}>
                      <Text style={[styles.simLabel, { color: colors.mutedForeground }]}>Aave Premium</Text>
                      <Text style={[styles.simValue, { color: colors.loss }]}>-{formatCurrency(simResult.premiumEstimate)}</Text>
                    </View>
                    <View style={styles.simRow}>
                      <Text style={[styles.simLabel, { color: colors.mutedForeground }]}>Gas Cost</Text>
                      <Text style={[styles.simValue, { color: colors.loss }]}>-{formatCurrency(simResult.gasEstimateUsd)} ({simResult.gasEstimate.toLocaleString()} gas)</Text>
                    </View>
                    <View style={[styles.simRow, { borderTopWidth: 1, borderTopColor: "#22c55e20", paddingTop: 6, marginTop: 2 }]}>
                      <Text style={[styles.simLabel, { color: "#22c55e", fontWeight: "700" }]}>Net Profit</Text>
                      <Text style={[styles.simValue, { color: simResult.netProfitEstimate > 0 ? "#22c55e" : colors.loss, fontWeight: "700" }]}>
                        {formatCurrency(simResult.netProfitEstimate)}
                      </Text>
                    </View>
                    <View style={styles.simRow}>
                      <Text style={[styles.simLabel, { color: colors.mutedForeground }]}>Slippage</Text>
                      <Text style={[styles.simValue, { color: colors.foreground }]}>{simResult.slippage.toFixed(3)}%</Text>
                    </View>
                  </View>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.cancelBtn, { backgroundColor: colors.muted }]}
                    onPress={closeModal}
                    activeOpacity={0.7}
                    disabled={simState === "simulating" || simState === "executing"}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>

                  {simState === "idle" || simState === "simulating" ? (
                    <TouchableOpacity
                      style={[styles.executeBtn, { backgroundColor: "#8b5cf6", opacity: simState === "simulating" ? 0.7 : 1 }]}
                      onPress={runSimulation}
                      activeOpacity={0.7}
                      disabled={simState === "simulating"}
                    >
                      {simState === "simulating" ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Feather name="cpu" size={16} color="#fff" />
                          <Text style={styles.executeBtnText}>Simulate</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.executeBtn, { backgroundColor: colors.primary, opacity: simState === "executing" ? 0.7 : 1, shadowColor: colors.primary }]}
                      onPress={executeLoan}
                      activeOpacity={0.7}
                      disabled={simState === "executing"}
                    >
                      {simState === "executing" ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Feather name="zap" size={16} color="#fff" />
                          <Text style={styles.executeBtnText}>Execute</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingText: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 12 },
  simModeBanner: { marginHorizontal: 20, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 4 },
  simModeText: { fontSize: 11, fontFamily: "Inter_500Medium", flex: 1 },
  errorBanner: { marginHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  errorText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  summaryRow: { flexDirection: "row", paddingHorizontal: 20, gap: 12, paddingTop: 16 },
  summaryCard: { flex: 1, padding: 16, gap: 6 },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  summaryValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statsCard: { marginHorizontal: 20, marginTop: 12, padding: 16 },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDivider: { width: 1, height: 32, marginHorizontal: 4 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 10, marginTop: 20 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sectionSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  list: { paddingHorizontal: 20, gap: 12 },
  oppCard: { padding: 16 },
  oppHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  oppRoute: { fontSize: 15, fontFamily: "Inter_700Bold", letterSpacing: -0.3, marginBottom: 4 },
  dexRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  dexName: { fontSize: 11, fontFamily: "Inter_400Regular" },
  networkBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  networkText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  oppStats: { flexDirection: "row", marginBottom: 12, borderRadius: 10, padding: 10, gap: 4 },
  oppStat: { flex: 1, alignItems: "center" },
  oppStatLabel: { fontSize: 9, fontFamily: "Inter_400Regular", marginBottom: 3, textAlign: "center" },
  oppStatValue: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  oppFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerLeft: { flexDirection: "row", alignItems: "center", gap: 4 },
  expiryText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  executeHint: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  executeHintText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  histCard: { marginHorizontal: 20, padding: 12, marginBottom: 8 },
  histRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  histIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  histRoute: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  histTx: { fontSize: 10, fontFamily: "Inter_400Regular" },
  histProfit: { fontSize: 13, fontFamily: "Inter_700Bold" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, shadowColor: "#000", shadowOffset: { width: 0, height: -10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 20 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", alignSelf: "center", marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 16, letterSpacing: -0.3 },
  modalRouteSection: { paddingBottom: 14, marginBottom: 14, borderBottomWidth: 1 },
  modalRouteText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  modalDexes: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  modalDetails: { gap: 8, marginBottom: 16 },
  modalDetailRow: { flexDirection: "row", justifyContent: "space-between" },
  modalDetailLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  modalDetailValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  simResult: { borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, gap: 6 },
  simTitle: { fontSize: 12, fontFamily: "Inter_700Bold", marginBottom: 4 },
  simRow: { flexDirection: "row", justifyContent: "space-between" },
  simLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  simValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  modalActions: { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  cancelBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  executeBtn: { flex: 1.5, paddingVertical: 16, borderRadius: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  executeBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
