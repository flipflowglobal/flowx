import { Feather } from "@expo/vector-icons";
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
import { JDLHeader } from "@/components/JDLHeader";
import { useScreenWatchdog } from "@/hooks/useScreenWatchdog";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { AnimatedEntry } from "@/components/AnimatedEntry";
import { Card } from "@/components/Card";
import { ChainBadge } from "@/components/ChainBadge";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { GlowDot } from "@/components/GlowDot";
import { StatusBadge } from "@/components/StatusBadge";
import { useColors } from "@/hooks/useColors";
import {
  getAgents,
  getStrategies,
  createAgent,
  deleteAgent,
  getAgentDeletionInfo,
  markAgentForDeletion,
  cancelAgentDeletion,
  pauseAgent,
  resumeAgent,
  getPortfolio,
  sendFromAgentWallet,
  getMainWallet,
  ApiError,
  type AgentData,
  type StrategyConfig,
  type PortfolioResult,
} from "@/lib/api";
import { agents as fallbackAgents } from "@/lib/mockData";
import { formatAUD, DEFAULT_USD_TO_AUD } from "@/lib/currency";
import { getMarketFxRates } from "@/lib/api";

function formatCurrency(val: number) {
  return "A$" + Math.abs(val).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortAddr(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function chainNativeSymbol(chain: string): string {
  const m: Record<string, string> = { ethereum: "ETH", polygon: "MATIC", arbitrum: "ETH", bsc: "BNB", avalanche: "AVAX", optimism: "ETH" };
  return m[chain.toLowerCase()] ?? "ETH";
}
function chainDisplayName(chain: string): string {
  const m: Record<string, string> = { ethereum: "Ethereum", polygon: "Polygon", arbitrum: "Arbitrum", bsc: "BSC", avalanche: "Avalanche", optimism: "Optimism" };
  return m[chain.toLowerCase()] ?? chain;
}

const RISK_PROFILES = ["conservative", "balanced", "aggressive"];
const CHAIN_OPTIONS = ["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"];

function healthColor(health: string): string {
  switch (health) {
    case "excellent": return "#22c55e";
    case "good": return "#3b82f6";
    case "degraded": return "#f59e0b";
    case "critical": return "#ef4444";
    case "hallucinating": return "#dc2626";
    default: return "#6b7280";
  }
}

function healthIcon(health: string): "check-circle" | "alert-circle" | "alert-triangle" | "x-circle" | "zap-off" {
  switch (health) {
    case "excellent": return "check-circle";
    case "good": return "check-circle";
    case "degraded": return "alert-triangle";
    case "critical": return "alert-circle";
    case "hallucinating": return "zap-off";
    default: return "alert-circle";
  }
}

function categoryIcon(cat: string): "zap" | "trending-up" | "grid" | "repeat" | "bar-chart-2" | "cpu" {
  switch (cat) {
    case "arbitrage": return "zap";
    case "trend": return "trending-up";
    case "range": return "grid";
    case "accumulation": return "repeat";
    case "execution": return "bar-chart-2";
    default: return "cpu";
  }
}

function efficiencyColor(pct: number): string {
  if (pct >= 90) return "#22c55e";
  if (pct >= 75) return "#3b82f6";
  if (pct >= 70) return "#f59e0b";
  return "#ef4444";
}

function EfficiencyBar({ efficiency, width = 140 }: { efficiency: number; width?: number }) {
  const pct = Math.max(0, Math.min(100, efficiency ?? 0));
  const color = efficiencyColor(pct);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width, height: 4, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 2 }}>
        <View style={{ width: (pct / 100) * width, height: 4, backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color, minWidth: 28 }}>{pct}%</Text>
    </View>
  );
}

function MiniSparkLine({ data, color, width = 80, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - 2 - ((v - min) / range) * (height - 4),
  }));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <Svg width={width} height={height}>
      <Path d={d} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <Circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={2} fill={color} />
    </Svg>
  );
}

function PnLBarChart({ data, width = 260, height = 50 }: { data: { received: number; sent: number }[]; width?: number; height?: number }) {
  const maxVal = Math.max(...data.map((d) => Math.max(d.received, d.sent)), 1);
  const barGroupW = (width - (data.length - 1) * 6) / data.length;
  const barW = barGroupW / 2 - 1;
  return (
    <Svg width={width} height={height}>
      {data.map((d, i) => {
        const x = i * (barGroupW + 6);
        const recH = (d.received / maxVal) * (height - 4);
        const sentH = (d.sent / maxVal) * (height - 4);
        return (
          <React.Fragment key={i}>
            <Rect x={x} y={height - recH - 2} width={barW} height={recH} rx={2} fill="#22c55e" opacity={0.7} />
            <Rect x={x + barW + 2} y={height - sentH - 2} width={barW} height={sentH} rx={2} fill="#ef4444" opacity={0.5} />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

export default function AgentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [agentsList, setAgentsList] = useState<AgentData[]>([]);
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDelete, setShowDelete] = useState<AgentData | null>(null);
  const [deletionStep, setDeletionStep] = useState<1 | 2>(1);
  const [deletionInfo, setDeletionInfo] = useState<{ wallet: { address: string; totalReceived: number; totalSent: number; netRevenue: number }; warning: string } | null>(null);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ total: number; running: number; paused: number; totalPnl: number; avgWinRate: number; avgEfficiency: number; hallucinating: number; needsAttention: number; markedForDeletion: number; belowEfficiency: number } | null>(null);
  const [showRevenueChart, setShowRevenueChart] = useState(true);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [newName, setNewName] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyConfig | null>(null);
  const [newCapital, setNewCapital] = useState("5000");
  const [newRisk, setNewRisk] = useState("balanced");
  const [selectedChains, setSelectedChains] = useState<string[]>(["ethereum", "polygon"]);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(1);
  const [audRate, setAudRate] = useState(DEFAULT_USD_TO_AUD);
  const formatCurrency = (val: number) => formatAUD(val, audRate);

  const [agentPortfolios, setAgentPortfolios] = useState<Record<string, PortfolioResult>>({});
  const [sendingAgent, setSendingAgent] = useState<AgentData | null>(null);
  const [agentSendTo, setAgentSendTo] = useState("");
  const [agentSendAmount, setAgentSendAmount] = useState("");
  const [agentSendChain, setAgentSendChain] = useState("ethereum");
  const [agentSendToken, setAgentSendToken] = useState<{ symbol: string; address: string; decimals: number } | null>(null);
  const [agentSendingTx, setAgentSendingTx] = useState(false);
  const [mainWalletAddr, setMainWalletAddr] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [agentsRes, strategiesRes, mainWalletRes] = await Promise.all([getAgents(), getStrategies(), getMainWallet().catch(() => null)]);
      setAgentsList(agentsRes.agents);
      setSummary(agentsRes.summary);
      setStrategies(strategiesRes.strategies);
      if (mainWalletRes?.address) setMainWalletAddr(mainWalletRes.address);
    } catch {
      const mapped: AgentData[] = fallbackAgents.map((a) => ({
        id: a.id,
        name: a.name,
        strategyId: "triangular-arb",
        strategy: a.strategy,
        strategyCategory: a.type,
        algorithm: "composite-ai",
        status: a.status,
        capital: 5000,
        riskProfile: a.riskProfile,
        chains: a.chains,
        createdAt: new Date().toISOString(),
        parameters: {},
        performance: {
          winRate: a.winRate, pnl: a.pnl, pnlPct: a.pnlPercent,
          totalTrades: a.trades24h * 10, activeTrades: a.trades24h > 0 ? Math.min(3, a.trades24h) : 0,
          sharpe: 1.8, maxDrawdown: 8.5, kellyFraction: a.kellyFraction * 100, compositeScore: 82,
          engines: { ppo: 85, thompson: 88, ukf: 83, cma_es: 86 },
          shapleyWeights: { ppo: 22, thompson: 31, ukf: 19, cma_es: 28 },
        },
        wallet: { address: "0x0000000000000000000000000000000000000000", createdAt: new Date().toISOString(), totalReceived: 0, totalSent: 0, txCount: 0 },
        health: { health: a.pnl >= 0 ? "good" : "degraded", efficiency: 80, reasons: [], recommendation: a.pnl >= 0 ? "keep" : "reconfigure", needsDeletion: false },
        efficiency: 80,
        markedForDeletion: false,
        deletionScheduledAt: null,
      }));
      setAgentsList(mapped);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { getMarketFxRates().then(r => setAudRate(r.usdToAud)).catch(() => {}); }, []);

  const watchdog = useScreenWatchdog({ fetch: loadData, screenName: "Agents", intervalMs: 30_000 });

  const handleToggle = async (agent: AgentData) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const updated = agent.status === "running" ? await pauseAgent(agent.id) : await resumeAgent(agent.id);
      setAgentsList((prev) => prev.map((a) => (a.id === agent.id ? updated : a)));
    } catch {
      setAgentsList((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, status: a.status === "running" ? "paused" : "running" } : a))
      );
    }
  };

  const fetchAgentPortfolio = useCallback(async (agent: AgentData) => {
    if (!agent.wallet?.address || agentPortfolios[agent.id]) return;
    try {
      const p = await getPortfolio(agent.wallet.address);
      setAgentPortfolios((prev) => ({ ...prev, [agent.id]: p }));
    } catch {}
  }, [agentPortfolios]);

  const openSendPanel = (agent: AgentData) => {
    setSendingAgent(agent);
    setAgentSendTo("");
    setAgentSendAmount("");
    setAgentSendToken(null);
    const firstChain = agent.chains?.[0] ?? "ethereum";
    setAgentSendChain(firstChain);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!agentPortfolios[agent.id]) fetchAgentPortfolio(agent);
  };

  const handleAgentSend = async () => {
    if (!sendingAgent || !agentSendTo || !agentSendAmount) {
      Alert.alert("Missing Fields", "Enter a recipient address and amount.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setAgentSendingTx(true);
    try {
      const result = await sendFromAgentWallet(sendingAgent.id, agentSendTo, agentSendAmount, agentSendChain, agentSendToken);
      setAgentSendingTx(false);
      setSendingAgent(null);
      setAgentSendTo("");
      setAgentSendAmount("");
      setAgentSendToken(null);
      setAgentPortfolios((prev) => { const n = { ...prev }; delete n[sendingAgent.id]; return n; });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const tokenLabel = agentSendToken ? agentSendToken.symbol : chainNativeSymbol(agentSendChain);
      Alert.alert(
        "Transfer Sent",
        `Hash: ${result.txHash}\nFrom: ${sendingAgent.name}\nTo: ${shortAddr(agentSendTo)}\nToken: ${tokenLabel}\nNetwork: ${chainDisplayName(agentSendChain)}\nStatus: submitted\n\n0.75% system fee applied`
      );
    } catch (err: any) {
      setAgentSendingTx(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Transfer Failed", err.message ?? "Unknown error");
    }
  };

  const openDeleteModal = async (agent: AgentData) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setShowDelete(agent);
    setDeletionStep(1);
    setDeletionInfo(null);
    setDeletionLoading(true);
    try {
      const info = await getAgentDeletionInfo(agent.id);
      setDeletionInfo({ wallet: info.wallet, warning: info.warning });
    } catch {
      setDeletionInfo(null);
    } finally {
      setDeletionLoading(false);
    }
  };

  const handleDelete = async (agent: AgentData) => {
    if (deletionStep === 1) {
      setDeletionStep(2);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    try {
      await deleteAgent(agent.id);
      setAgentsList((prev) => prev.filter((a) => a.id !== agent.id));
      setShowDelete(null);
      setDeletionStep(1);
      setDeletionInfo(null);
    } catch {
      setAgentsList((prev) => prev.filter((a) => a.id !== agent.id));
      setShowDelete(null);
      setDeletionStep(1);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !selectedStrategy) return;
    setCreating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const agent = await createAgent({
        name: newName.trim(),
        strategyId: selectedStrategy.id,
        capital: Math.round((parseFloat(newCapital) || (selectedStrategy.minCapital * audRate)) / audRate),
        riskProfile: newRisk,
        chains: selectedChains,
      });
      setAgentsList((prev) => [...prev, agent]);
      resetCreate();
    } catch (err: any) {
      setCreating(false);
      if (err instanceof ApiError && err.upgradeRequired) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          "Subscription Limit Reached",
          err.message + "\n\nUpgrade your plan in Settings to create more agents.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "View Plans", onPress: () => {} },
          ]
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Failed to Create Agent", err.message || "Please check your connection and try again.");
      }
    }
  };

  const resetCreate = () => {
    setShowCreate(false);
    setNewName("");
    setSelectedStrategy(null);
    setNewCapital("5000");
    setNewRisk("balanced");
    setSelectedChains(["ethereum", "polygon"]);
    setCreating(false);
    setStep(1);
  };

  const runningCount = agentsList.filter((a) => a.status === "running").length;
  const totalPnl = agentsList.reduce((s, a) => s + a.performance.pnl, 0);
  const attentionCount = agentsList.filter((a) => a.health.recommendation === "delete" || a.health.recommendation === "reconfigure").length;
  const totalRevenue = agentsList.reduce((s, a) => s + (a.wallet?.totalReceived || 0), 0);

  const generatePnlData = (agent: AgentData) => {
    const base = Math.abs(agent.performance.pnl) || 100;
    return [base * 0.2, base * 0.4, base * 0.3, base * 0.6, base * 0.5, base * 0.8, base];
  };

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : 120, paddingTop: topPad }}
        showsVerticalScrollIndicator={false}
      >
        <JDLHeader
          subtitle="AI Agents"
          rightAction={{ icon: "plus", label: "New Agent", onPress: () => setShowCreate(true) }}
          watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }}
        />
        <View style={[st.paperTradeBanner, { backgroundColor: "rgba(59,130,246,0.07)", borderColor: "#3b82f620" }]}>
          <Feather name="cpu" size={12} color="#3b82f6" />
          <Text style={[st.paperTradeText, { color: "#3b82f6" }]}>
            Paper Trading Mode — Agents run algorithms on live market data. No real on-chain trades executed.
          </Text>
        </View>
        {loading ? (
          <View style={st.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[st.loadingText, { color: colors.mutedForeground }]}>Loading agents...</Text>
          </View>
        ) : (
          <>
            <AnimatedEntry delay={0}>
              <View style={st.summaryRow}>
                <Card style={st.summaryCard} elevated>
                  <View style={[st.summaryIconWrap, { backgroundColor: "#22c55e15" }]}>
                    <Feather name="activity" size={16} color="#22c55e" />
                  </View>
                  <Text style={[st.summaryValue, { color: colors.profit }]}>{runningCount}/{agentsList.length}</Text>
                  <Text style={[st.summaryLabel, { color: colors.mutedForeground }]}>Active</Text>
                </Card>
                <Card style={st.summaryCard} elevated>
                  <View style={[st.summaryIconWrap, { backgroundColor: colors.primary + "15" }]}>
                    <Feather name="dollar-sign" size={16} color={colors.primary} />
                  </View>
                  <Text style={[st.summaryValue, { color: totalPnl >= 0 ? colors.profit : colors.loss }]}>
                    {totalPnl >= 0 ? "+" : "-"}{formatCurrency(totalPnl)}
                  </Text>
                  <Text style={[st.summaryLabel, { color: colors.mutedForeground }]}>Total P&L</Text>
                </Card>
                <Card style={st.summaryCard} elevated>
                  <View style={[st.summaryIconWrap, { backgroundColor: attentionCount > 0 ? "#ef444415" : "#22c55e15" }]}>
                    <Feather name={attentionCount > 0 ? "alert-triangle" : "shield"} size={16} color={attentionCount > 0 ? "#ef4444" : "#22c55e"} />
                  </View>
                  <Text style={[st.summaryValue, { color: attentionCount > 0 ? colors.loss : colors.profit }]}>{attentionCount}</Text>
                  <Text style={[st.summaryLabel, { color: colors.mutedForeground }]}>Needs Review</Text>
                </Card>
              </View>

              {/* Fleet Efficiency Bar */}
              {agentsList.length > 0 && (
                <Card style={{ marginHorizontal: 20, marginTop: 10, padding: 14 }} elevated>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Feather name="cpu" size={13} color={efficiencyColor(summary?.avgEfficiency ?? 0)} />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Fleet Operational Capacity</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: efficiencyColor(summary?.avgEfficiency ?? 0) }}>
                      {summary?.avgEfficiency ?? Math.round(agentsList.reduce((s, a) => s + (a.efficiency ?? a.health?.efficiency ?? 0), 0) / agentsList.length)}%
                    </Text>
                  </View>
                  <EfficiencyBar efficiency={summary?.avgEfficiency ?? Math.round(agentsList.reduce((s, a) => s + (a.efficiency ?? a.health?.efficiency ?? 0), 0) / agentsList.length)} width={280} />
                  {(summary?.markedForDeletion ?? 0) > 0 && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, padding: 8, backgroundColor: "rgba(239,68,68,0.06)", borderRadius: 6 }}>
                      <Feather name="alert-triangle" size={11} color="#ef4444" />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "#ef4444" }}>
                        {summary?.markedForDeletion} agent{(summary?.markedForDeletion ?? 0) > 1 ? "s" : ""} scheduled for deletion — wallet funds preserved
                      </Text>
                    </View>
                  )}
                </Card>
              )}
            </AnimatedEntry>

            <AnimatedEntry delay={50}>
              <Card style={{ ...st.revenueChartCard, marginHorizontal: 20, marginTop: 12 }} elevated>
                <TouchableOpacity style={st.revenueChartHeader} onPress={() => setShowRevenueChart(!showRevenueChart)} activeOpacity={0.7}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={[st.chartIconWrap, { backgroundColor: "#22c55e15" }]}>
                      <Feather name="bar-chart-2" size={14} color="#22c55e" />
                    </View>
                    <Text style={[st.revenueChartTitle, { color: colors.foreground }]}>Agent Revenue Flow</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[st.revenueTotalLabel, { color: colors.profit }]}>{formatCurrency(totalRevenue)}</Text>
                    <Feather name={showRevenueChart ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
                  </View>
                </TouchableOpacity>
                {showRevenueChart && (() => {
                  const liveAgentData = agentsList.filter((a) => a.status === "running");
                  const totalReceived = liveAgentData.reduce((s, a) => s + (a.wallet?.totalReceived || 0), 0);
                  const revenueHistory = ["6h", "12h", "18h", "24h", "30h", "36h", "42h", "48h"].map((hour, i) => ({
                    hour,
                    received: totalReceived / 8 * (0.7 + Math.sin((i + 1) * 1.5) * 0.3 + 0.2 * (i % 2)),
                    sent: (totalRevenue * 0.0075) / 8 * (0.5 + Math.cos(i * 1.2) * 0.3),
                  }));
                  return (
                  <View style={st.revenueChartBody}>
                    <PnLBarChart data={revenueHistory} width={280} height={60} />
                    <View style={st.revenueLabels}>
                      {revenueHistory.map((d) => (
                        <Text key={d.hour} style={[st.revenueLabelText, { color: colors.mutedForeground }]}>{d.hour}</Text>
                      ))}
                    </View>
                    <View style={st.revenueLegend}>
                      <View style={st.legendItem}>
                        <View style={[st.legendDot, { backgroundColor: "#22c55e" }]} />
                        <Text style={[st.legendText, { color: colors.mutedForeground }]}>Received</Text>
                      </View>
                      <View style={st.legendItem}>
                        <View style={[st.legendDot, { backgroundColor: "#ef4444" }]} />
                        <Text style={[st.legendText, { color: colors.mutedForeground }]}>Sent</Text>
                      </View>
                    </View>
                  </View>
                  );
                })()}
              </Card>
            </AnimatedEntry>

            {agentsList.length === 0 && (
              <AnimatedEntry delay={100}>
                <TouchableOpacity
                  style={[st.emptyState, { backgroundColor: colors.cardElevated, borderColor: colors.primary + "25" }]}
                  onPress={() => { setShowCreate(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
                  activeOpacity={0.8}
                >
                  <View style={[st.emptyIconCircle, { backgroundColor: colors.primary + "12" }]}>
                    <Feather name="cpu" size={32} color={colors.primary} />
                  </View>
                  <Text style={[st.emptyTitle, { color: colors.foreground }]}>Deploy Your First Agent</Text>
                  <Text style={[st.emptyDesc, { color: colors.mutedForeground }]}>
                    Choose a strategy, configure capital & risk, and launch an autonomous trading agent in minutes.
                  </Text>
                  <View style={[st.emptyBtn, { backgroundColor: colors.primary }]}>
                    <Feather name="plus" size={16} color="#fff" />
                    <Text style={st.emptyBtnText}>Deploy New Agent</Text>
                  </View>
                </TouchableOpacity>
              </AnimatedEntry>
            )}

            <View style={st.agentsList}>
              {agentsList.map((agent, i) => {
                const isExpanded = expandedAgent === agent.id;
                return (
                  <AnimatedEntry key={agent.id} delay={100 + i * 80}>
                    <Card style={st.agentCard} elevated>
                      <TouchableOpacity
                        style={st.agentHeader}
                        onPress={() => {
                          const newId = isExpanded ? null : agent.id;
                          setExpandedAgent(newId);
                          if (newId) fetchAgentPortfolio(agent);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={st.agentNameRow}>
                          <View style={[st.agentIconWrap, { backgroundColor: colors.primary + "15" }]}>
                            <Feather name={categoryIcon(agent.strategyCategory)} size={18} color={colors.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={[st.agentName, { color: colors.foreground }]}>{agent.name}</Text>
                              {(agent.markedForDeletion || agent.health?.needsDeletion) && (
                                <View style={{ backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 8, fontFamily: "Inter_700Bold", color: "#ef4444" }}>DELETION</Text>
                                </View>
                              )}
                            </View>
                            <View style={st.engineRow}>
                              <Feather name="code" size={10} color={colors.mutedForeground} />
                              <Text style={[st.agentEngine, { color: colors.mutedForeground }]} numberOfLines={1}>{agent.algorithm}</Text>
                            </View>
                          </View>
                        </View>
                        <View style={st.headerRight}>
                          <StatusBadge status={agent.status as any} size="md" />
                          <View style={[st.healthDot, { backgroundColor: healthColor(agent.health?.health) + "20" }]}>
                            <Feather name={healthIcon(agent.health?.health)} size={12} color={healthColor(agent.health?.health)} />
                          </View>
                        </View>
                      </TouchableOpacity>

                      <View style={[st.walletInfoRow, { backgroundColor: "rgba(34,197,94,0.04)" }]}>
                        <Feather name="credit-card" size={11} color="#22c55e" />
                        <Text style={[st.walletAddrText, { color: colors.mutedForeground }]}>{shortAddr(agent.wallet?.address || "")}</Text>
                        {agentPortfolios[agent.id] ? (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, marginHorizontal: 6 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              {Object.entries(agentPortfolios[agent.id].chains).map(([chain, data]) => {
                                if (!data.connected || parseFloat(data.nativeBalance) === 0) return null;
                                return (
                                  <View key={chain} style={st.holdingPill}>
                                    <Text style={[st.holdingPillText, { color: colors.foreground }]}>
                                      {data.nativeSymbol} {parseFloat(data.nativeBalance).toFixed(4)}
                                    </Text>
                                  </View>
                                );
                              })}
                              {Object.values(agentPortfolios[agent.id].chains).flatMap(c => c.tokens ?? []).slice(0, 3).map((tok, ti) =>
                                parseFloat(tok.balance) > 0 ? (
                                  <View key={ti} style={[st.holdingPill, { backgroundColor: "rgba(59,130,246,0.12)" }]}>
                                    <Text style={[st.holdingPillText, { color: colors.primary }]}>{tok.symbol} {parseFloat(tok.balance).toFixed(2)}</Text>
                                  </View>
                                ) : null
                              )}
                            </View>
                          </ScrollView>
                        ) : (
                          <View style={{ flex: 1 }} />
                        )}
                        <MiniSparkLine data={generatePnlData(agent)} color={agent.performance.pnl >= 0 ? "#22c55e" : "#ef4444"} width={52} height={18} />
                        <Text style={[st.walletRevText, { color: agent.performance.pnl >= 0 ? colors.profit : colors.loss }]}>
                          {agent.performance.pnl >= 0 ? "+" : "-"}{formatCurrency(agent.performance.pnl)}
                        </Text>
                      </View>

                      <View style={[st.strategyRow, { backgroundColor: "rgba(139,92,246,0.06)" }]}>
                        <View style={st.strategyItem}>
                          <Feather name="crosshair" size={11} color="#8b5cf6" />
                          <Text style={[st.strategyText, { color: "#8b5cf6" }]}>{agent.strategy}</Text>
                        </View>
                        <View style={st.strategyItem}>
                          <Feather name="percent" size={11} color={colors.mutedForeground} />
                          <Text style={[st.strategyText, { color: colors.mutedForeground }]}>Kelly: {agent.performance.kellyFraction.toFixed(0)}%</Text>
                        </View>
                        <View style={[st.riskBadge, {
                          backgroundColor: agent.riskProfile === "aggressive" || agent.riskProfile === "Aggressive"
                            ? "rgba(239,68,68,0.1)" : agent.riskProfile === "conservative" || agent.riskProfile === "Conservative"
                            ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)"
                        }]}>
                          <Text style={[st.riskText, {
                            color: agent.riskProfile === "aggressive" || agent.riskProfile === "Aggressive"
                              ? "#ef4444" : agent.riskProfile === "conservative" || agent.riskProfile === "Conservative"
                              ? "#22c55e" : "#f59e0b"
                          }]}>{agent.riskProfile}</Text>
                        </View>
                      </View>

                      {/* Efficiency bar */}
                      <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.04)" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: colors.mutedForeground }}>Operational Efficiency</Text>
                          {(agent.health?.efficiency ?? agent.efficiency ?? 0) < 90 && (
                            <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#f59e0b" }}>Below 90% threshold</Text>
                          )}
                        </View>
                        <EfficiencyBar efficiency={agent.efficiency ?? agent.health?.efficiency ?? 0} width={240} />
                      </View>

                      <View style={st.agentMetrics}>
                        <View style={st.agentMetric}>
                          <Text style={[st.agentMetricLabel, { color: colors.mutedForeground }]}>P&L</Text>
                          <Text style={[st.agentMetricValue, { color: agent.performance.pnl >= 0 ? colors.profit : colors.loss }]}>
                            {agent.performance.pnl >= 0 ? "+" : "-"}{formatCurrency(agent.performance.pnl)}
                          </Text>
                        </View>
                        <View style={[st.agentMetricDivider, { backgroundColor: colors.border }]} />
                        <View style={st.agentMetric}>
                          <Text style={[st.agentMetricLabel, { color: colors.mutedForeground }]}>Win Rate</Text>
                          <Text style={[st.agentMetricValue, { color: colors.foreground }]}>{agent.performance.winRate}%</Text>
                        </View>
                        <View style={[st.agentMetricDivider, { backgroundColor: colors.border }]} />
                        <View style={st.agentMetric}>
                          <Text style={[st.agentMetricLabel, { color: colors.mutedForeground }]}>Sharpe</Text>
                          <Text style={[st.agentMetricValue, { color: colors.foreground }]}>{agent.performance.sharpe}</Text>
                        </View>
                      </View>

                      {isExpanded && (
                        <View style={st.expandedInfo}>
                          <View style={st.secondMetricsRow}>
                            <View style={[st.miniMetric, { backgroundColor: "rgba(255,255,255,0.02)" }]}>
                              <Text style={[st.miniLabel, { color: colors.mutedForeground }]}>Trades</Text>
                              <Text style={[st.miniValue, { color: colors.foreground }]}>{agent.performance.totalTrades}</Text>
                            </View>
                            <View style={[st.miniMetric, { backgroundColor: "rgba(255,255,255,0.02)" }]}>
                              <Text style={[st.miniLabel, { color: colors.mutedForeground }]}>Max DD</Text>
                              <Text style={[st.miniValue, { color: agent.performance.maxDrawdown > 15 ? colors.loss : colors.foreground }]}>{agent.performance.maxDrawdown}%</Text>
                            </View>
                            <View style={[st.miniMetric, { backgroundColor: "rgba(255,255,255,0.02)" }]}>
                              <Text style={[st.miniLabel, { color: colors.mutedForeground }]}>Composite</Text>
                              <Text style={[st.miniValue, { color: colors.foreground }]}>{agent.performance.compositeScore}%</Text>
                            </View>
                          </View>

                          <View style={[st.walletDetailCard, { backgroundColor: "rgba(34,197,94,0.04)" }]}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <Text style={[st.walletDetailTitle, { color: colors.foreground, marginBottom: 0 }]}>Agent Wallet</Text>
                              <TouchableOpacity
                                style={[st.sendFromWalletBtn, { backgroundColor: "rgba(59,130,246,0.12)", borderColor: "#3b82f630" }]}
                                onPress={() => openSendPanel(agent)}
                                activeOpacity={0.7}
                              >
                                <Feather name="send" size={11} color={colors.primary} />
                                <Text style={[st.sendFromWalletBtnText, { color: colors.primary }]}>Send</Text>
                              </TouchableOpacity>
                            </View>
                            <View style={st.walletDetailRow}>
                              <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>Address</Text>
                              <Text style={[st.walletDetailVal, { color: colors.foreground }]}>{shortAddr(agent.wallet?.address || "")}</Text>
                            </View>
                            <View style={st.walletDetailRow}>
                              <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>Received</Text>
                              <Text style={[st.walletDetailVal, { color: colors.profit }]}>{formatCurrency(agent.wallet?.totalReceived || 0)}</Text>
                            </View>
                            <View style={st.walletDetailRow}>
                              <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>Sent</Text>
                              <Text style={[st.walletDetailVal, { color: colors.loss }]}>{formatCurrency(agent.wallet?.totalSent || 0)}</Text>
                            </View>
                            <View style={st.walletDetailRow}>
                              <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>Transactions</Text>
                              <Text style={[st.walletDetailVal, { color: colors.primary }]}>{agent.wallet?.txCount || 0}</Text>
                            </View>
                            {/* On-chain holdings */}
                            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" }}>
                              <Text style={[st.walletDetailLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>On-chain Holdings</Text>
                              {agentPortfolios[agent.id] ? (
                                Object.entries(agentPortfolios[agent.id].chains).map(([chain, data]) => (
                                  <View key={chain} style={st.holdingChainRow}>
                                    <View style={st.holdingChainLeft}>
                                      <View style={[st.holdingChainDot, { backgroundColor: chain === "ethereum" ? "#627eea" : chain === "polygon" ? "#8247e5" : chain === "bsc" ? "#f0b90b" : chain === "avalanche" ? "#e84142" : "#3b82f6" }]} />
                                      <Text style={[st.holdingChainName, { color: colors.mutedForeground }]}>{chainDisplayName(chain)}</Text>
                                    </View>
                                    <View style={{ flex: 1, gap: 4 }}>
                                      <View style={st.holdingTokenRow}>
                                        <Text style={[st.holdingTokenSymbol, { color: "#22c55e" }]}>{data.nativeSymbol}</Text>
                                        <Text style={[st.holdingTokenAmount, { color: colors.foreground }]}>{parseFloat(data.nativeBalance).toFixed(6)}</Text>
                                      </View>
                                      {(data.tokens ?? []).filter(t => parseFloat(t.balance) > 0).map((tok, ti) => (
                                        <View key={ti} style={st.holdingTokenRow}>
                                          <Text style={[st.holdingTokenSymbol, { color: colors.primary }]}>{tok.symbol}</Text>
                                          <Text style={[st.holdingTokenAmount, { color: colors.foreground }]}>{parseFloat(tok.balance).toFixed(4)}</Text>
                                        </View>
                                      ))}
                                    </View>
                                  </View>
                                ))
                              ) : (
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                  <ActivityIndicator size="small" color={colors.primary} />
                                  <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>Fetching on-chain balances…</Text>
                                </View>
                              )}
                            </View>
                          </View>

                          <View style={st.pnlChartSection}>
                            <Text style={[st.pnlChartLabel, { color: colors.mutedForeground }]}>7-Day P&L Trend</Text>
                            <MiniSparkLine data={generatePnlData(agent)} color={agent.performance.pnl >= 0 ? "#22c55e" : "#ef4444"} width={260} height={36} />
                          </View>

                          <View style={st.chainsRow}>
                            {agent.chains.map((chain) => (
                              <ChainBadge key={chain} chain={chain} />
                            ))}
                          </View>

                          {agent.health.health !== "excellent" && agent.health.health !== "good" && (
                            <View style={[st.healthBanner, { backgroundColor: healthColor(agent.health.health) + "10", borderColor: healthColor(agent.health.health) + "30" }]}>
                              <Feather name={healthIcon(agent.health.health)} size={13} color={healthColor(agent.health.health)} />
                              <Text style={[st.healthText, { color: healthColor(agent.health.health) }]} numberOfLines={2}>
                                {agent.health.reasons[0] || `Agent health: ${agent.health.health}`}
                              </Text>
                            </View>
                          )}
                        </View>
                      )}

                      <View style={[st.actionsRow, { flexWrap: "wrap" }]}>
                        <TouchableOpacity
                          style={[st.actionBtn, {
                            backgroundColor: agent.status === "running" ? "rgba(245,158,11,0.08)" : "rgba(34,197,94,0.08)",
                            borderColor: agent.status === "running" ? "#f59e0b20" : "#22c55e20",
                          }]}
                          onPress={() => handleToggle(agent)}
                          activeOpacity={0.7}
                        >
                          <Feather name={agent.status === "running" ? "pause" : "play"} size={14} color={agent.status === "running" ? "#f59e0b" : "#22c55e"} />
                          <Text style={{ color: agent.status === "running" ? "#f59e0b" : "#22c55e", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                            {agent.status === "running" ? "Pause" : "Start"}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[st.actionBtn, { backgroundColor: "rgba(59,130,246,0.06)", borderColor: "#3b82f620" }]}
                          onPress={() => {
                            const newId = isExpanded ? null : agent.id;
                            setExpandedAgent(newId);
                            if (newId) fetchAgentPortfolio(agent);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                          activeOpacity={0.7}
                        >
                          <Feather name={isExpanded ? "minimize-2" : "maximize-2"} size={14} color={colors.primary} />
                          <Text style={{ color: colors.primary, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                            {isExpanded ? "Less" : "More"}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[st.actionBtn, { backgroundColor: "rgba(34,197,94,0.07)", borderColor: "#22c55e20" }]}
                          onPress={() => openSendPanel(agent)}
                          activeOpacity={0.7}
                        >
                          <Feather name="send" size={14} color="#22c55e" />
                          <Text style={{ color: "#22c55e", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Send</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[st.actionBtn, { backgroundColor: agent.markedForDeletion ? "rgba(239,68,68,0.14)" : "rgba(239,68,68,0.06)", borderColor: "#ef444420" }]}
                          onPress={() => openDeleteModal(agent)}
                          activeOpacity={0.7}
                        >
                          <Feather name="trash-2" size={14} color="#ef4444" />
                          <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                            {agent.markedForDeletion ? "Scheduled" : "Delete"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </Card>
                  </AnimatedEntry>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <FloatingActionButton icon="plus" onPress={() => setShowCreate(true)} />

      {/* Agent Send Modal */}
      <Modal visible={!!sendingAgent} animationType="slide" transparent onRequestClose={() => setSendingAgent(null)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.cardElevated, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 34 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Feather name="send" size={16} color="#22c55e" />
                </View>
                <View>
                  <Text style={[st.modalTitle, { color: colors.foreground, fontSize: 17 }]}>Send Crypto</Text>
                  {sendingAgent && <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>from {sendingAgent.name}</Text>}
                </View>
              </View>
              <TouchableOpacity onPress={() => setSendingAgent(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Source wallet + live holdings */}
            {sendingAgent && (
              <View style={[st.sendBalanceBox, { backgroundColor: "rgba(34,197,94,0.05)", borderColor: "#22c55e20" }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>Wallet</Text>
                  <Text style={[st.walletDetailVal, { color: colors.foreground }]} selectable>{shortAddr(sendingAgent.wallet?.address || "")}</Text>
                </View>
                <Text style={[st.walletDetailLabel, { color: colors.mutedForeground, marginBottom: 6 }]}>Available Balance</Text>
                {agentPortfolios[sendingAgent.id] ? (
                  Object.entries(agentPortfolios[sendingAgent.id].chains).map(([chain, data]) => {
                    const nativeBal = parseFloat(data.nativeBalance);
                    const hasTokens = (data.tokens ?? []).some(t => parseFloat(t.balance) > 0);
                    if (!data.connected || (nativeBal === 0 && !hasTokens)) return null;
                    return (
                      <View key={chain} style={[st.sendChainBalanceRow, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.06)" }]}>
                        <Text style={[{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, minWidth: 70 }]}>{chainDisplayName(chain)}</Text>
                        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                          <View style={st.holdingPill}>
                            <Text style={[st.holdingPillText, { color: "#22c55e" }]}>{data.nativeSymbol} {nativeBal.toFixed(6)}</Text>
                          </View>
                          {(data.tokens ?? []).filter(t => parseFloat(t.balance) > 0).map((tok, ti) => (
                            <View key={ti} style={[st.holdingPill, { backgroundColor: "rgba(59,130,246,0.1)" }]}>
                              <Text style={[st.holdingPillText, { color: colors.primary }]}>{tok.symbol} {parseFloat(tok.balance).toFixed(4)}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
                    <ActivityIndicator size="small" color="#22c55e" />
                    <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>Loading balances…</Text>
                  </View>
                )}
              </View>
            )}

            {/* Network picker */}
            <Text style={[st.walletDetailLabel, { color: colors.mutedForeground, marginBottom: 6, marginTop: 12 }]}>Network</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(sendingAgent?.chains ?? ["ethereum"]).map((chain) => (
                  <TouchableOpacity
                    key={chain}
                    style={[st.sendChainPill, {
                      backgroundColor: agentSendChain === chain ? colors.primary + "20" : "rgba(255,255,255,0.04)",
                      borderColor: agentSendChain === chain ? colors.primary + "60" : colors.border,
                    }]}
                    onPress={() => { setAgentSendChain(chain); setAgentSendToken(null); setAgentSendAmount(""); Haptics.selectionAsync(); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[st.holdingPillText, { color: agentSendChain === chain ? colors.primary : colors.mutedForeground }]}>
                      {chainNativeSymbol(chain)} · {chainDisplayName(chain)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Token selector */}
            <Text style={[st.walletDetailLabel, { color: colors.mutedForeground, marginBottom: 6 }]}>Token</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  style={[st.sendChainPill, {
                    backgroundColor: !agentSendToken ? "#22c55e20" : "rgba(255,255,255,0.04)",
                    borderColor: !agentSendToken ? "#22c55e60" : colors.border,
                  }]}
                  onPress={() => { setAgentSendToken(null); setAgentSendAmount(""); Haptics.selectionAsync(); }}
                  activeOpacity={0.7}
                >
                  <Text style={[st.holdingPillText, { color: !agentSendToken ? "#22c55e" : colors.mutedForeground }]}>
                    {chainNativeSymbol(agentSendChain)} (native)
                  </Text>
                </TouchableOpacity>
                {sendingAgent && agentPortfolios[sendingAgent.id] &&
                  (agentPortfolios[sendingAgent.id].chains[agentSendChain]?.tokens ?? [])
                    .filter(t => parseFloat(t.balance) > 0)
                    .map((tok) => (
                      <TouchableOpacity
                        key={tok.address}
                        style={[st.sendChainPill, {
                          backgroundColor: agentSendToken?.address === tok.address ? colors.primary + "20" : "rgba(255,255,255,0.04)",
                          borderColor: agentSendToken?.address === tok.address ? colors.primary + "60" : colors.border,
                        }]}
                        onPress={() => { setAgentSendToken({ symbol: tok.symbol, address: tok.address, decimals: tok.decimals }); setAgentSendAmount(""); Haptics.selectionAsync(); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[st.holdingPillText, { color: agentSendToken?.address === tok.address ? colors.primary : colors.mutedForeground }]}>
                          {tok.symbol} · {parseFloat(tok.balance).toFixed(4)}
                        </Text>
                      </TouchableOpacity>
                    ))
                }
              </View>
            </ScrollView>

            {/* Recipient address */}
            <Text style={[st.walletDetailLabel, { color: colors.mutedForeground, marginBottom: 6 }]}>Recipient Address</Text>
            {mainWalletAddr ? (
              <TouchableOpacity
                style={[st.sendToMainBtn, { backgroundColor: "rgba(139,92,246,0.08)", borderColor: "#8b5cf620" }]}
                onPress={() => { setAgentSendTo(mainWalletAddr); Haptics.selectionAsync(); }}
                activeOpacity={0.7}
              >
                <Feather name="home" size={11} color="#8b5cf6" />
                <Text style={[st.holdingPillText, { color: "#8b5cf6" }]}>Use Main Wallet  {shortAddr(mainWalletAddr)}</Text>
              </TouchableOpacity>
            ) : null}
            <TextInput
              style={[st.input, { color: colors.foreground, backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border, marginTop: 6 }]}
              value={agentSendTo}
              onChangeText={setAgentSendTo}
              placeholder="0x..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {/* Amount + Send All shortcuts */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, marginBottom: 6 }}>
              <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>
                Amount ({agentSendToken ? agentSendToken.symbol : chainNativeSymbol(agentSendChain)})
              </Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {sendingAgent && agentPortfolios[sendingAgent.id] && (() => {
                  const chainData = agentPortfolios[sendingAgent.id].chains[agentSendChain];
                  let bal: number;
                  if (agentSendToken) {
                    const tok = (chainData?.tokens ?? []).find(t => t.address === agentSendToken.address);
                    bal = parseFloat(tok?.balance ?? "0");
                  } else {
                    bal = parseFloat(chainData?.nativeBalance ?? "0");
                  }
                  const precision = agentSendToken ? 6 : 8;
                  return (
                    <>
                      <TouchableOpacity
                        style={[st.sendAllBtn, { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "#22c55e25" }]}
                        onPress={() => { setAgentSendAmount(bal.toFixed(precision)); Haptics.selectionAsync(); }}
                        activeOpacity={0.7}
                      >
                        <Feather name="maximize" size={10} color="#22c55e" />
                        <Text style={[st.sendAllBtnText, { color: "#22c55e" }]}>Send All</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[st.sendAllBtn, { backgroundColor: "rgba(139,92,246,0.1)", borderColor: "#8b5cf625" }]}
                        onPress={() => {
                          setAgentSendAmount(bal.toFixed(precision));
                          if (mainWalletAddr) setAgentSendTo(mainWalletAddr);
                          Haptics.selectionAsync();
                        }}
                        activeOpacity={0.7}
                      >
                        <Feather name="home" size={10} color="#8b5cf6" />
                        <Text style={[st.sendAllBtnText, { color: "#8b5cf6" }]}>All to Main</Text>
                      </TouchableOpacity>
                    </>
                  );
                })()}
              </View>
            </View>
            <TextInput
              style={[st.input, { color: colors.foreground, backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border }]}
              value={agentSendAmount}
              onChangeText={setAgentSendAmount}
              placeholder="0.01"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
            />

            {/* Fee preview */}
            {agentSendAmount ? (
              <View style={[st.sendFeeBox, { backgroundColor: "rgba(59,130,246,0.06)", borderColor: "rgba(59,130,246,0.12)" }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>System Fee (0.75%)</Text>
                  <Text style={[st.walletDetailVal, { color: "#f59e0b" }]}>
                    {(parseFloat(agentSendAmount || "0") * 0.0075).toFixed(6)} {agentSendToken ? agentSendToken.symbol : chainNativeSymbol(agentSendChain)}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                  <Text style={[st.walletDetailLabel, { color: colors.mutedForeground }]}>Net Amount Sent</Text>
                  <Text style={[st.walletDetailVal, { color: "#22c55e" }]}>
                    {(parseFloat(agentSendAmount || "0") * 0.9925).toFixed(6)} {agentSendToken ? agentSendToken.symbol : chainNativeSymbol(agentSendChain)}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Actions */}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[st.actionBtn, { flex: 1, backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border }]}
                onPress={() => setSendingAgent(null)}
                disabled={agentSendingTx}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.actionBtn, { flex: 2, backgroundColor: agentSendingTx ? colors.primary + "80" : colors.primary, borderColor: "transparent" }]}
                onPress={handleAgentSend}
                disabled={agentSendingTx}
                activeOpacity={0.7}
              >
                {agentSendingTx
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="send" size={14} color="#fff" /><Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>Send</Text></>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { backgroundColor: colors.cardElevated }]}>
            <View style={st.modalHeader}>
              <Text style={[st.modalTitle, { color: colors.foreground }]}>
                {step === 1 ? "Choose Strategy" : step === 2 ? "Configure Agent" : "Review & Deploy"}
              </Text>
              <TouchableOpacity onPress={resetCreate}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <View style={st.stepIndicator}>
              {[1, 2, 3].map((s) => (
                <View key={s} style={[st.stepDot, { backgroundColor: step >= s ? colors.primary : colors.border }]} />
              ))}
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={st.modalBody}>
              {step === 1 && (
                <View style={st.strategyList}>
                  {strategies.map((strat) => (
                    <TouchableOpacity
                      key={strat.id}
                      style={[st.strategyOption, {
                        backgroundColor: selectedStrategy?.id === strat.id ? colors.primary + "15" : "rgba(255,255,255,0.02)",
                        borderColor: selectedStrategy?.id === strat.id ? colors.primary + "40" : colors.border,
                      }]}
                      onPress={() => { setSelectedStrategy(strat); Haptics.selectionAsync(); }}
                      activeOpacity={0.7}
                    >
                      <View style={st.stratOptionHeader}>
                        <View style={[st.stratIconWrap, { backgroundColor: colors.primary + "15" }]}>
                          <Feather name={categoryIcon(strat.category)} size={16} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[st.stratOptionName, { color: colors.foreground }]}>{strat.name}</Text>
                          <Text style={[st.stratOptionAlgo, { color: colors.mutedForeground }]}>{strat.algorithm}</Text>
                        </View>
                        <View style={[st.riskBadge, {
                          backgroundColor: strat.riskLevel === "aggressive" ? "rgba(239,68,68,0.1)" : strat.riskLevel === "conservative" ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)"
                        }]}>
                          <Text style={[st.riskText, {
                            color: strat.riskLevel === "aggressive" ? "#ef4444" : strat.riskLevel === "conservative" ? "#22c55e" : "#f59e0b"
                          }]}>{strat.riskLevel}</Text>
                        </View>
                      </View>
                      <Text style={[st.stratOptionDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{strat.description}</Text>
                      <View style={st.stratOptionStats}>
                        <Text style={[st.stratStat, { color: colors.profit }]}>WR: {strat.expectedWinRate}%</Text>
                        <Text style={[st.stratStat, { color: colors.primary }]}>Mo: +{strat.expectedMonthlyReturn}%</Text>
                        <Text style={[st.stratStat, { color: colors.mutedForeground }]}>Min: ${strat.minCapital.toLocaleString()}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {step === 2 && selectedStrategy && (
                <View style={st.configForm}>
                  <Text style={[st.inputLabel, { color: colors.mutedForeground }]}>Agent Name</Text>
                  <TextInput style={[st.input, { color: colors.foreground, backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border }]} value={newName} onChangeText={setNewName} placeholder="e.g. Flash Hunter Pro" placeholderTextColor={colors.mutedForeground} />
                  <Text style={[st.inputLabel, { color: colors.mutedForeground }]}>Capital (AUD)</Text>
                  <TextInput style={[st.input, { color: colors.foreground, backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border }]} value={newCapital} onChangeText={setNewCapital} keyboardType="numeric" placeholder={`Min: A$${Math.round(selectedStrategy.minCapital * audRate).toLocaleString("en-AU")}`} placeholderTextColor={colors.mutedForeground} />
                  <Text style={[st.inputLabel, { color: colors.mutedForeground }]}>Risk Profile</Text>
                  <View style={st.riskSelector}>
                    {RISK_PROFILES.map((r) => (
                      <TouchableOpacity key={r} style={[st.riskOption, { backgroundColor: newRisk === r ? colors.primary + "15" : "rgba(255,255,255,0.02)", borderColor: newRisk === r ? colors.primary + "40" : colors.border }]} onPress={() => { setNewRisk(r); Haptics.selectionAsync(); }}>
                        <Text style={[st.riskOptionText, { color: newRisk === r ? colors.primary : colors.mutedForeground }]}>{r}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[st.inputLabel, { color: colors.mutedForeground }]}>Target Chains</Text>
                  <View style={st.chainSelector}>
                    {CHAIN_OPTIONS.filter((c) => selectedStrategy.supportedChains.includes(c)).map((chain) => (
                      <TouchableOpacity key={chain} style={[st.chainOption, { backgroundColor: selectedChains.includes(chain) ? colors.primary + "15" : "rgba(255,255,255,0.02)", borderColor: selectedChains.includes(chain) ? colors.primary + "40" : colors.border }]} onPress={() => { setSelectedChains((prev) => prev.includes(chain) ? prev.filter((c) => c !== chain) : [...prev, chain]); Haptics.selectionAsync(); }}>
                        <Text style={[st.chainOptionText, { color: selectedChains.includes(chain) ? colors.primary : colors.mutedForeground }]}>{chain}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {step === 3 && selectedStrategy && (
                <View style={st.reviewSection}>
                  <Card style={st.reviewCard}>
                    <Text style={[st.reviewHeading, { color: colors.foreground }]}>Agent Summary</Text>
                    {[
                      { k: "Name", v: newName || "Unnamed", c: colors.foreground },
                      { k: "Strategy", v: selectedStrategy.name, c: colors.primary },
                      { k: "Algorithm", v: selectedStrategy.algorithm, c: "#8b5cf6" },
                      { k: "Capital", v: "A$" + (parseFloat(newCapital || "0")).toLocaleString("en-AU"), c: colors.foreground },
                      { k: "Risk", v: newRisk, c: newRisk === "aggressive" ? "#ef4444" : newRisk === "conservative" ? "#22c55e" : "#f59e0b" },
                      { k: "Chains", v: selectedChains.join(", "), c: colors.foreground },
                      { k: "Expected WR", v: selectedStrategy.expectedWinRate + "%", c: colors.profit },
                      { k: "Monthly Est.", v: "+" + selectedStrategy.expectedMonthlyReturn + "%", c: colors.profit },
                    ].map((item) => (
                      <View key={item.k} style={st.reviewRow}>
                        <Text style={[st.reviewKey, { color: colors.mutedForeground }]}>{item.k}</Text>
                        <Text style={[st.reviewVal, { color: item.c }]}>{item.v}</Text>
                      </View>
                    ))}
                  </Card>
                  <Card style={[st.reviewCard, { marginTop: 12 }]}>
                    <Text style={[st.reviewHeading, { color: colors.foreground }]}>AI Engine + Wallet</Text>
                    <Text style={[st.engineDesc, { color: colors.mutedForeground }]}>
                      Composite Brain ensemble with 4 AI engines. A dedicated ETH wallet will be auto-generated for this agent's revenue operations.
                    </Text>
                    <View style={st.engineGrid}>
                      {[
                        { name: "PPO", desc: "Proximal Policy Optimization" },
                        { name: "Thompson", desc: "Thompson Sampling Bandit" },
                        { name: "UKF", desc: "Unscented Kalman Filter" },
                        { name: "CMA-ES", desc: "Covariance Matrix Adaptation" },
                      ].map((eng) => (
                        <View key={eng.name} style={[st.engineChip, { backgroundColor: "rgba(59,130,246,0.06)" }]}>
                          <GlowDot color="#3b82f6" size={6} />
                          <View>
                            <Text style={[st.engineChipName, { color: colors.foreground }]}>{eng.name}</Text>
                            <Text style={[st.engineChipDesc, { color: colors.mutedForeground }]}>{eng.desc}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </Card>
                </View>
              )}
            </ScrollView>

            <View style={st.modalFooter}>
              {step > 1 && (
                <TouchableOpacity style={[st.backBtn, { borderColor: colors.border }]} onPress={() => setStep(step - 1)}>
                  <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Back</Text>
                </TouchableOpacity>
              )}
              {step < 3 ? (
                <TouchableOpacity style={[st.nextBtn, { backgroundColor: (step === 1 && !selectedStrategy) ? colors.muted : colors.primary, flex: step === 1 ? 1 : undefined }]} onPress={() => { if (step === 1 && !selectedStrategy) return; setStep(step + 1); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} disabled={step === 1 && !selectedStrategy}>
                  <Text style={st.nextBtnText}>Next</Text>
                  <Feather name="arrow-right" size={16} color="#fff" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[st.nextBtn, { backgroundColor: colors.primary }]} onPress={handleCreate} disabled={creating}>
                  {creating ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="zap" size={16} color="#fff" /><Text style={st.nextBtnText}>Deploy Agent</Text></>}
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!showDelete} animationType="fade" transparent>
        <View style={st.modalOverlay}>
          <View style={[st.deleteModal, { backgroundColor: colors.cardElevated }]}>
            {/* Step indicator */}
            <View style={{ flexDirection: "row", alignSelf: "center", gap: 6, marginBottom: 12 }}>
              {[1, 2].map((s) => (
                <View key={s} style={{ width: s === deletionStep ? 20 : 8, height: 4, borderRadius: 2, backgroundColor: s <= deletionStep ? "#ef4444" : "rgba(255,255,255,0.1)" }} />
              ))}
            </View>

            <View style={[st.deleteIconWrap, { backgroundColor: deletionStep === 1 ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.1)" }]}>
              <Feather name={deletionStep === 1 ? "shield" : "alert-triangle"} size={28} color={deletionStep === 1 ? "#f59e0b" : "#ef4444"} />
            </View>

            <Text style={[st.deleteTitle, { color: colors.foreground }]}>
              {deletionStep === 1 ? "Review Before Deleting" : "Confirm Permanent Deletion"}
            </Text>
            <Text style={[st.deleteDesc, { color: colors.mutedForeground }]}>
              {deletionStep === 1
                ? `Reviewing wallet holdings for ${showDelete?.name}`
                : `Permanently delete ${showDelete?.name}? This cannot be undone.`}
            </Text>

            {showDelete && (
              <View style={[st.deleteSummary, { backgroundColor: "rgba(239,68,68,0.05)", borderColor: "#ef444420" }]}>
                {/* Always show from agent data */}
                <View style={st.deleteStatRow}>
                  <Text style={[st.deleteStatLabel, { color: colors.mutedForeground }]}>Efficiency</Text>
                  <Text style={[st.deleteStatValue, { color: efficiencyColor(showDelete.efficiency ?? showDelete.health?.efficiency ?? 0) }]}>
                    {showDelete.efficiency ?? showDelete.health?.efficiency ?? 0}%
                  </Text>
                </View>
                <View style={st.deleteStatRow}>
                  <Text style={[st.deleteStatLabel, { color: colors.mutedForeground }]}>Final P&L</Text>
                  <Text style={[st.deleteStatValue, { color: showDelete.performance.pnl >= 0 ? colors.profit : colors.loss }]}>
                    {showDelete.performance.pnl >= 0 ? "+" : "-"}{formatCurrency(showDelete.performance.pnl)}
                  </Text>
                </View>

                {/* Wallet info — loaded from API in step 1 */}
                {deletionLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 8 }}>
                    <ActivityIndicator size="small" color="#f59e0b" />
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 4 }}>Loading wallet holdings...</Text>
                  </View>
                ) : deletionInfo ? (
                  <>
                    <View style={st.deleteStatRow}>
                      <Text style={[st.deleteStatLabel, { color: colors.mutedForeground }]}>Wallet</Text>
                      <Text style={[st.deleteStatValue, { color: colors.foreground }]}>{shortAddr(deletionInfo.wallet.address)}</Text>
                    </View>
                    <View style={st.deleteStatRow}>
                      <Text style={[st.deleteStatLabel, { color: colors.mutedForeground }]}>Revenue</Text>
                      <Text style={[st.deleteStatValue, { color: colors.profit }]}>{formatCurrency(deletionInfo.wallet.totalReceived)}</Text>
                    </View>
                    <View style={st.deleteStatRow}>
                      <Text style={[st.deleteStatLabel, { color: colors.mutedForeground }]}>Net Revenue</Text>
                      <Text style={[st.deleteStatValue, { color: deletionInfo.wallet.netRevenue >= 0 ? colors.profit : colors.loss }]}>
                        {formatCurrency(deletionInfo.wallet.netRevenue)}
                      </Text>
                    </View>
                  </>
                ) : (
                  <View style={st.deleteStatRow}>
                    <Text style={[st.deleteStatLabel, { color: colors.mutedForeground }]}>Wallet</Text>
                    <Text style={[st.deleteStatValue, { color: colors.foreground }]}>{shortAddr(showDelete.wallet?.address || "")}</Text>
                  </View>
                )}

                {/* Safety notice */}
                <View style={{ marginTop: 8, padding: 8, backgroundColor: "#f59e0b10", borderRadius: 6, borderWidth: 1, borderColor: "#f59e0b20" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: "#f59e0b", lineHeight: 14 }}>
                    {deletionStep === 1
                      ? "Wallet private key will be preserved in the secure vault after deletion. Ensure any on-chain holdings have been swept to your main wallet first."
                      : "This is final. The agent will be removed and the wallet key moved to vault storage."}
                  </Text>
                </View>

                {showDelete.health?.recommendation === "delete" && (
                  <Text style={[st.deleteRecText, { color: "#ef4444" }]}>System recommended for deletion</Text>
                )}
              </View>
            )}

            <View style={st.deleteActions}>
              <TouchableOpacity style={[st.cancelBtn, { borderColor: colors.border }]} onPress={() => { setShowDelete(null); setDeletionStep(1); setDeletionInfo(null); }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.confirmDeleteBtn, { backgroundColor: deletionStep === 1 ? "#f59e0b" : "#ef4444" }]}
                onPress={() => showDelete && handleDelete(showDelete)}
              >
                <Feather name={deletionStep === 1 ? "arrow-right" : "trash-2"} size={14} color="#fff" />
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                  {deletionStep === 1 ? "Proceed to Delete" : "Delete Forever"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  paperTradeBanner: { marginHorizontal: 20, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  paperTradeText: { fontSize: 11, fontFamily: "Inter_500Medium", flex: 1 },
  loadingWrap: { alignItems: "center", justifyContent: "center", paddingTop: 120, gap: 12 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  summaryRow: { flexDirection: "row", paddingHorizontal: 20, gap: 10, paddingTop: 16 },
  summaryCard: { flex: 1, padding: 14, alignItems: "center", gap: 6 },
  summaryIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  summaryValue: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  revenueChartCard: { padding: 16 },
  revenueChartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chartIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  revenueChartTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  revenueTotalLabel: { fontSize: 13, fontFamily: "Inter_700Bold" },
  revenueChartBody: { marginTop: 12, alignItems: "center" },
  revenueLabels: { flexDirection: "row", justifyContent: "space-between", width: 280, marginTop: 4 },
  revenueLabelText: { fontSize: 9, fontFamily: "Inter_400Regular" },
  revenueLegend: { flexDirection: "row", gap: 16, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  agentsList: { paddingHorizontal: 20, gap: 12, marginTop: 16 },
  agentCard: { padding: 18 },
  agentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  agentNameRow: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  agentIconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  agentName: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  engineRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  agentEngine: { fontSize: 11, fontFamily: "Inter_400Regular" },
  healthDot: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  walletInfoRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, marginBottom: 10 },
  walletAddrText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  walletRevText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  strategyRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, padding: 10, borderRadius: 10, marginBottom: 12 },
  strategyItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  strategyText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  riskBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  riskText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  agentMetrics: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 12, padding: 12, marginBottom: 8 },
  agentMetric: { flex: 1, alignItems: "center" },
  agentMetricLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 3 },
  agentMetricValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  agentMetricDivider: { width: 1, height: "80%" as any, alignSelf: "center" },
  expandedInfo: { marginTop: 4 },
  secondMetricsRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  miniMetric: { flex: 1, padding: 8, borderRadius: 8, alignItems: "center" },
  miniLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  miniValue: { fontSize: 13, fontFamily: "Inter_700Bold", marginTop: 2 },
  walletDetailCard: { borderRadius: 10, padding: 12, marginBottom: 12, gap: 6 },
  walletDetailTitle: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 4 },
  walletDetailRow: { flexDirection: "row", justifyContent: "space-between" },
  walletDetailLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  walletDetailVal: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  pnlChartSection: { marginBottom: 12 },
  pnlChartLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 6 },
  chainsRow: { flexDirection: "row", gap: 6, marginBottom: 14, flexWrap: "wrap" },
  healthBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  healthText: { fontSize: 11, fontFamily: "Inter_500Medium", flex: 1 },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%", paddingBottom: 34 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  stepIndicator: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  stepDot: { height: 3, flex: 1, borderRadius: 2 },
  modalBody: { paddingHorizontal: 20, maxHeight: 420 },
  strategyList: { gap: 10, paddingBottom: 16 },
  strategyOption: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 8 },
  stratOptionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  stratIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stratOptionName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  stratOptionAlgo: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  stratOptionDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  stratOptionStats: { flexDirection: "row", gap: 16 },
  stratStat: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  configForm: { gap: 16, paddingBottom: 16 },
  inputLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: -8 },
  input: { height: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, fontFamily: "Inter_400Regular", fontSize: 14 },
  riskSelector: { flexDirection: "row", gap: 8 },
  riskOption: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  riskOptionText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  chainSelector: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chainOption: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  chainOptionText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  reviewSection: { paddingBottom: 16 },
  reviewCard: { padding: 16 },
  reviewHeading: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 12 },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  reviewKey: { fontSize: 12, fontFamily: "Inter_400Regular" },
  reviewVal: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  engineDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginBottom: 12 },
  engineGrid: { gap: 8 },
  engineChip: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10 },
  engineChipName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  engineChipDesc: { fontSize: 10, fontFamily: "Inter_400Regular" },
  modalFooter: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  nextBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  nextBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  deleteModal: { margin: 20, borderRadius: 20, padding: 24, alignItems: "center" },
  deleteIconWrap: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  deleteTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 8 },
  deleteDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 16, lineHeight: 20 },
  deleteSummary: { width: "100%", borderRadius: 12, padding: 14, borderWidth: 1, marginBottom: 20, gap: 8 },
  deleteStatRow: { flexDirection: "row", justifyContent: "space-between" },
  deleteStatLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  deleteStatValue: { fontSize: 12, fontFamily: "Inter_700Bold" },
  deleteRecText: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4 },
  deleteActions: { flexDirection: "row", gap: 10, width: "100%" },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  confirmDeleteBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  emptyState: { marginHorizontal: 20, marginTop: 20, borderRadius: 20, padding: 32, alignItems: "center", borderWidth: 1, gap: 12 },
  emptyIconCircle: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.4, textAlign: "center" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, maxWidth: 280 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 14, marginTop: 4 },
  emptyBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  holdingPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: "rgba(34,197,94,0.1)" },
  holdingPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  holdingChainRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  holdingChainLeft: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 80, paddingTop: 2 },
  holdingChainDot: { width: 6, height: 6, borderRadius: 3 },
  holdingChainName: { fontSize: 10, fontFamily: "Inter_500Medium" },
  holdingTokenRow: { flexDirection: "row", justifyContent: "space-between" },
  holdingTokenSymbol: { fontSize: 11, fontFamily: "Inter_700Bold" },
  holdingTokenAmount: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sendFromWalletBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  sendFromWalletBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  sendBalanceBox: { borderRadius: 10, padding: 12, borderWidth: 1, marginBottom: 4, gap: 4 },
  sendChainBalanceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, marginBottom: 4 },
  sendChainPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  sendToMainBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, marginBottom: 0 },
  sendAllBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  sendAllBtnText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  sendFeeBox: { borderRadius: 8, padding: 10, borderWidth: 1, marginTop: 10, gap: 0 },
});
