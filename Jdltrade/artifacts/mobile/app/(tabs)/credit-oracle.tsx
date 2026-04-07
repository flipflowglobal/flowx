import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { useColors } from "@/hooks/useColors";
import { getCreditScore, getOracleQueries, type CreditScoreResult, type OracleQueriesResult } from "@/lib/api";

function gradeColor(grade: string): string {
  if (grade === "AAA" || grade === "AA") return "#22c55e";
  if (grade === "A" || grade === "BBB") return "#3b82f6";
  if (grade === "BB" || grade === "B") return "#f59e0b";
  if (grade === "CCC" || grade === "CC") return "#ef4444";
  return "#dc2626";
}

function riskColor(risk: string): string {
  if (risk === "minimal") return "#22c55e";
  if (risk === "low") return "#3b82f6";
  if (risk === "moderate") return "#f59e0b";
  if (risk === "elevated") return "#f97316";
  return "#ef4444";
}

function scoreArc(score: number): number {
  return ((score - 300) / 550) * 100;
}

const MAIN_WALLET = "0x8b74BCA1f75160A8bFD2907938B3662Dc62A6C03";

export default function CreditOracleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [searchAddress, setSearchAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreditScoreResult | null>(null);
  const [queries, setQueries] = useState<OracleQueriesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoLoaded, setAutoLoaded] = useState(false);

  const [statsError, setStatsError] = useState(false);

  const loadOracleStats = useCallback(async () => {
    try {
      setStatsError(false);
      const q = await getOracleQueries();
      setQueries(q);
    } catch {
      setStatsError(true);
    }
  }, []);

  useEffect(() => {
    loadOracleStats();
    if (!autoLoaded) {
      handleSearch(MAIN_WALLET);
      setAutoLoaded(true);
    }
  }, []);

  const watchdog = useScreenWatchdog({ fetch: loadOracleStats, screenName: "Credit Oracle", intervalMs: 45_000 });

  const handleSearch = async (addr?: string) => {
    const address = addr || searchAddress.trim();
    if (!address) return;
    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await getCreditScore(address);
      setResult(res);
      loadOracleStats();
    } catch (err: any) {
      setError(err.message || "Failed to compute credit score");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const breakdown = result?.breakdown;
  const cs = result?.creditScore;
  const att = result?.attestation;

  const breakdownItems = breakdown ? [
    { label: "Wallet Age", key: "walletAge" as const, icon: "clock" as const },
    { label: "Transaction History", key: "transactionHistory" as const, icon: "repeat" as const },
    { label: "DeFi Activity", key: "defiActivity" as const, icon: "layers" as const },
    { label: "Sybil Resistance", key: "sybilResistance" as const, icon: "shield" as const },
    { label: "Loan Repayment", key: "loanRepayment" as const, icon: "check-circle" as const },
    { label: "Governance", key: "governance" as const, icon: "award" as const },
    { label: "NFT Profile", key: "nftProfile" as const, icon: "image" as const },
    { label: "Balance Health", key: "balanceHealth" as const, icon: "dollar-sign" as const },
  ] : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : 120, paddingTop: topPad }}
        showsVerticalScrollIndicator={false}
      >
        <JDLHeader subtitle="Credit Oracle" watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }} />
        <AnimatedEntry delay={0}>
          <View style={styles.headerSection}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.oracleIconWrap, { backgroundColor: "#8b5cf615" }]}>
                <Feather name="shield" size={20} color="#8b5cf6" />
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: colors.foreground }]}>Credit Oracle</Text>
                <View style={styles.headerSubRow}>
                  <GlowDot color="#8b5cf6" size={5} />
                  <Text style={[styles.headerSub, { color: "#8b5cf6" }]}>EAS Attestation Service</Text>
                </View>
              </View>
            </View>
            <Text style={[styles.headerDesc, { color: colors.mutedForeground }]}>
              Uncollateralized lending credit scores from on-chain wallet history. Sybil resistance, loan repayments, DeFi interactions — all analyzed.
            </Text>
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={80}>
          <View style={styles.searchSection}>
            <View style={[styles.searchBar, { backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border }]}>
              <Feather name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.searchInput, { color: colors.foreground }]}
                value={searchAddress}
                onChangeText={setSearchAddress}
                placeholder="Enter wallet address (0x...)"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <TouchableOpacity
              style={[styles.searchBtn, { backgroundColor: "#8b5cf6" }]}
              onPress={() => handleSearch()}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Feather name="zap" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {error && (
          <AnimatedEntry delay={100}>
            <View style={[styles.errorBanner, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "#ef444430" }]}>
              <Feather name="alert-circle" size={14} color="#ef4444" />
              <Text style={[styles.errorText, { color: "#ef4444" }]}>{error}</Text>
            </View>
          </AnimatedEntry>
        )}

        {loading && !result && (
          <View style={styles.loadingSection}>
            <ActivityIndicator size="large" color="#8b5cf6" />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Crawling wallet history...</Text>
            <Text style={[styles.loadingSubText, { color: colors.mutedForeground }]}>Analyzing across Ethereum, Polygon, Arbitrum</Text>
          </View>
        )}

        {cs && (
          <>
            <AnimatedEntry delay={100}>
              <Card style={styles.scoreCard} elevated>
                <View style={styles.scoreHeader}>
                  <View>
                    <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>DeFi Credit Score</Text>
                    <Text style={[styles.scoreAddress, { color: colors.mutedForeground }]}>
                      {cs.address.slice(0, 6)}...{cs.address.slice(-4)}
                    </Text>
                  </View>
                  <View style={[styles.gradeBadge, { backgroundColor: gradeColor(cs.grade) + "15", borderColor: gradeColor(cs.grade) + "40" }]}>
                    <Text style={[styles.gradeText, { color: gradeColor(cs.grade) }]}>{cs.grade}</Text>
                  </View>
                </View>

                <View style={styles.scoreCenter}>
                  <Text style={[styles.scoreValue, { color: gradeColor(cs.grade) }]}>{cs.score}</Text>
                  <Text style={[styles.scoreScale, { color: colors.mutedForeground }]}>/ 850</Text>
                </View>

                <View style={[styles.scoreBarTrack, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
                  <View style={[styles.scoreBarFill, { width: `${scoreArc(cs.score)}%`, backgroundColor: gradeColor(cs.grade) }]} />
                </View>
                <View style={styles.scoreBarLabels}>
                  <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>300</Text>
                  <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>850</Text>
                </View>

                <View style={styles.scoreMetricsRow}>
                  <View style={styles.scoreMetric}>
                    <Text style={[styles.smLabel, { color: colors.mutedForeground }]}>Max Borrow</Text>
                    <Text style={[styles.smValue, { color: colors.foreground }]}>${cs.maxBorrowUsd.toLocaleString()}</Text>
                  </View>
                  <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.scoreMetric}>
                    <Text style={[styles.smLabel, { color: colors.mutedForeground }]}>Risk Level</Text>
                    <Text style={[styles.smValue, { color: riskColor(cs.riskLevel) }]}>{cs.riskLevel}</Text>
                  </View>
                  <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.scoreMetric}>
                    <Text style={[styles.smLabel, { color: colors.mutedForeground }]}>Confidence</Text>
                    <Text style={[styles.smValue, { color: colors.foreground }]}>{cs.confidence}%</Text>
                  </View>
                </View>

                <View style={[styles.feeRow, { backgroundColor: "rgba(139,92,246,0.06)" }]}>
                  <Feather name="info" size={12} color="#8b5cf6" />
                  <Text style={[styles.feeText, { color: "#8b5cf6" }]}>
                    Oracle fee: {result?.oracleFee} ETH per query  |  Query: {result?.queryId?.slice(0, 12)}...
                  </Text>
                </View>
              </Card>
            </AnimatedEntry>

            <AnimatedEntry delay={200}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Score Breakdown</Text>
                <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>8 weighted dimensions</Text>
              </View>
            </AnimatedEntry>

            {breakdownItems.map((item, i) => {
              const data = breakdown![item.key];
              return (
                <AnimatedEntry key={item.key} delay={250 + i * 50}>
                  <Card style={styles.breakdownCard}>
                    <View style={styles.breakdownRow}>
                      <View style={styles.breakdownLeft}>
                        <View style={[styles.breakdownIconWrap, { backgroundColor: "rgba(139,92,246,0.08)" }]}>
                          <Feather name={item.icon} size={14} color="#8b5cf6" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.breakdownLabel, { color: colors.foreground }]}>{item.label}</Text>
                          <Text style={[styles.breakdownWeight, { color: colors.mutedForeground }]}>Weight: {(data.weight * 100).toFixed(0)}%</Text>
                        </View>
                      </View>
                      <View style={styles.breakdownRight}>
                        <Text style={[styles.breakdownScore, { color: data.score >= 70 ? "#22c55e" : data.score >= 40 ? "#f59e0b" : "#ef4444" }]}>{data.score}</Text>
                        <Text style={[styles.breakdownContrib, { color: colors.mutedForeground }]}>+{data.weighted.toFixed(1)}</Text>
                      </View>
                    </View>
                    <View style={[styles.breakdownBarTrack, { backgroundColor: "rgba(255,255,255,0.04)" }]}>
                      <View style={[styles.breakdownBarFill, {
                        width: `${data.score}%`,
                        backgroundColor: data.score >= 70 ? "#22c55e" : data.score >= 40 ? "#f59e0b" : "#ef4444",
                      }]} />
                    </View>
                  </Card>
                </AnimatedEntry>
              );
            })}

            {att && (
              <AnimatedEntry delay={700}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>EAS Attestation</Text>
                  <View style={[styles.easBadge, { backgroundColor: "#22c55e15" }]}>
                    <Feather name="check-circle" size={12} color="#22c55e" />
                    <Text style={[styles.easBadgeText, { color: "#22c55e" }]}>On-Chain</Text>
                  </View>
                </View>

                <Card style={styles.attestCard} elevated>
                  <View style={styles.attestRow}>
                    <Text style={[styles.attestKey, { color: colors.mutedForeground }]}>UID</Text>
                    <Text style={[styles.attestVal, { color: colors.foreground }]} numberOfLines={1}>{att.uid.slice(0, 18)}...</Text>
                  </View>
                  <View style={styles.attestRow}>
                    <Text style={[styles.attestKey, { color: colors.mutedForeground }]}>Schema</Text>
                    <Text style={[styles.attestVal, { color: "#8b5cf6" }]} numberOfLines={1}>{att.schemaId.slice(0, 18)}...</Text>
                  </View>
                  <View style={styles.attestRow}>
                    <Text style={[styles.attestKey, { color: colors.mutedForeground }]}>Attester</Text>
                    <Text style={[styles.attestVal, { color: colors.foreground }]} numberOfLines={1}>{att.attester.slice(0, 18)}...</Text>
                  </View>
                  <View style={styles.attestRow}>
                    <Text style={[styles.attestKey, { color: colors.mutedForeground }]}>Chain</Text>
                    <Text style={[styles.attestVal, { color: colors.primary }]}>{att.chain}</Text>
                  </View>
                  <View style={styles.attestRow}>
                    <Text style={[styles.attestKey, { color: colors.mutedForeground }]}>Tx Hash</Text>
                    <Text style={[styles.attestVal, { color: colors.foreground }]} numberOfLines={1}>{att.txHash.slice(0, 18)}...</Text>
                  </View>
                  <View style={styles.attestRow}>
                    <Text style={[styles.attestKey, { color: colors.mutedForeground }]}>Revocable</Text>
                    <Text style={[styles.attestVal, { color: colors.foreground }]}>{att.revocable ? "Yes" : "No"}</Text>
                  </View>
                  <View style={styles.attestRow}>
                    <Text style={[styles.attestKey, { color: colors.mutedForeground }]}>Expires</Text>
                    <Text style={[styles.attestVal, { color: colors.foreground }]}>{new Date(att.expirationTime * 1000).toLocaleDateString()}</Text>
                  </View>

                  <View style={[styles.dataSection, { backgroundColor: "rgba(255,255,255,0.02)", borderColor: colors.border }]}>
                    <Text style={[styles.dataLabel, { color: colors.mutedForeground }]}>Encoded Attestation Data</Text>
                    <Text style={[styles.dataValue, { color: "#8b5cf6" }]} numberOfLines={3}>{att.data.slice(0, 120)}...</Text>
                  </View>
                </Card>
              </AnimatedEntry>
            )}

            {statsError && (
              <AnimatedEntry delay={800}>
                <Card style={styles.revenueCard}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", paddingVertical: 8 }}>
                    <Feather name="alert-triangle" size={14} color="#f59e0b" />
                    <Text style={{ color: "#f59e0b", fontSize: 12, fontFamily: "Inter_500Medium" }}>Oracle stats unavailable</Text>
                    <TouchableOpacity onPress={loadOracleStats} activeOpacity={0.7}>
                      <Text style={{ color: colors.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              </AnimatedEntry>
            )}

            {queries && (
              <AnimatedEntry delay={800}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Oracle Revenue</Text>
                  <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>Zero-capital execution</Text>
                </View>

                <Card style={styles.revenueCard} elevated>
                  <View style={styles.revenueRow}>
                    <View style={styles.revMetric}>
                      <Text style={[styles.revValue, { color: colors.foreground }]}>{queries.stats.totalQueries}</Text>
                      <Text style={[styles.revLabel, { color: colors.mutedForeground }]}>Total Queries</Text>
                    </View>
                    <View style={[styles.revDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.revMetric}>
                      <Text style={[styles.revValue, { color: "#22c55e" }]}>{queries.stats.totalFeesEarned} ETH</Text>
                      <Text style={[styles.revLabel, { color: colors.mutedForeground }]}>Fees Earned</Text>
                    </View>
                    <View style={[styles.revDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.revMetric}>
                      <Text style={[styles.revValue, { color: colors.foreground }]}>{queries.stats.uniqueAddresses}</Text>
                      <Text style={[styles.revLabel, { color: colors.mutedForeground }]}>Unique Wallets</Text>
                    </View>
                  </View>
                  <View style={[styles.revenueNote, { backgroundColor: "rgba(34,197,94,0.06)" }]}>
                    <Feather name="dollar-sign" size={12} color="#22c55e" />
                    <Text style={[styles.revenueNoteText, { color: "#22c55e" }]}>
                      Revenue model: Lending protocols pay 0.001 ETH per credit query via smart contract
                    </Text>
                  </View>
                </Card>
              </AnimatedEntry>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerSection: { paddingHorizontal: 20, paddingTop: 16, marginBottom: 16 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  oracleIconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  headerSubRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  headerSub: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  headerDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  searchSection: { flexDirection: "row", paddingHorizontal: 20, gap: 10, marginBottom: 16 },
  searchBar: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, height: 48 },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  searchBtn: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  errorBanner: { marginHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16 },
  errorText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  loadingSection: { alignItems: "center", paddingTop: 60, gap: 12 },
  loadingText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  loadingSubText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  scoreCard: { marginHorizontal: 20, padding: 20, marginBottom: 20 },
  scoreHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  scoreLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  scoreAddress: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  gradeBadge: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  gradeText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  scoreCenter: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", marginBottom: 16 },
  scoreValue: { fontSize: 56, fontFamily: "Inter_700Bold", letterSpacing: -2 },
  scoreScale: { fontSize: 18, fontFamily: "Inter_400Regular", marginLeft: 4 },
  scoreBarTrack: { height: 6, borderRadius: 3, marginBottom: 4 },
  scoreBarFill: { height: 6, borderRadius: 3 },
  scoreBarLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  barLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  scoreMetricsRow: { flexDirection: "row", marginBottom: 12 },
  scoreMetric: { flex: 1, alignItems: "center" },
  smLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginBottom: 3 },
  smValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  scoreDivider: { width: 1, height: "80%" as any, alignSelf: "center" },
  feeRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8 },
  feeText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 12, marginTop: 8 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sectionSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  breakdownCard: { marginHorizontal: 20, padding: 14, marginBottom: 8 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  breakdownLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  breakdownIconWrap: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  breakdownLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  breakdownWeight: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  breakdownRight: { alignItems: "flex-end" },
  breakdownScore: { fontSize: 18, fontFamily: "Inter_700Bold" },
  breakdownContrib: { fontSize: 10, fontFamily: "Inter_400Regular" },
  breakdownBarTrack: { height: 3, borderRadius: 2 },
  breakdownBarFill: { height: 3, borderRadius: 2 },
  easBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  easBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  attestCard: { marginHorizontal: 20, padding: 16, marginBottom: 16 },
  attestRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  attestKey: { fontSize: 12, fontFamily: "Inter_400Regular" },
  attestVal: { fontSize: 12, fontFamily: "Inter_600SemiBold", maxWidth: "60%" as any, textAlign: "right" },
  dataSection: { marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1 },
  dataLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  dataValue: { fontSize: 10, fontFamily: "Inter_400Regular", lineHeight: 16 },
  revenueCard: { marginHorizontal: 20, padding: 16, marginBottom: 20 },
  revenueRow: { flexDirection: "row", marginBottom: 12 },
  revMetric: { flex: 1, alignItems: "center" },
  revValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  revLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  revDivider: { width: 1, height: "80%" as any, alignSelf: "center" },
  revenueNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8 },
  revenueNoteText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
});
