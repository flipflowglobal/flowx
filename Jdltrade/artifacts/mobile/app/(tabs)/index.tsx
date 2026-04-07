import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { useUser } from "@clerk/expo";
import { AnimatedEntry } from "@/components/AnimatedEntry";
import { Card } from "@/components/Card";
import { GlowDot } from "@/components/GlowDot";
import { ProgressRing } from "@/components/ProgressRing";
import { StatusBadge } from "@/components/StatusBadge";
import { JDLHeader } from "@/components/JDLHeader";
import { useScreenWatchdog } from "@/hooks/useScreenWatchdog";
import { useColors } from "@/hooks/useColors";
import { getAgents, getActivitySummary, getFlashLoanOpportunities, getDashboardSummary, getMarketFxRates, type AgentActivityRecord } from "@/lib/api";
import { formatAUD, formatAUDCompact, DEFAULT_USD_TO_AUD } from "@/lib/currency";

function CountUpText({ value, prefix = "", suffix = "", style }: { value: number; prefix?: string; suffix?: string; style: any }) {
  const animValue = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = useState(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current?.stop();
    const listenerId = animValue.addListener(({ value: v }) => setDisplayValue(v));
    const anim = Animated.timing(animValue, { toValue: value, duration: 1400, useNativeDriver: false });
    animRef.current = anim;
    anim.start();
    return () => {
      animRef.current?.stop();
      animValue.removeListener(listenerId);
    };
  }, [value]);

  return (
    <Text style={style}>
      {prefix}{displayValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{suffix}
    </Text>
  );
}

function PortfolioChart({ data, color, width = 300, height = 120 }: { data: { day: string; value: number }[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const range = max - min || 1;
  const pad = 6;
  const pts = data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (width - pad * 2),
    y: pad + (1 - (d.value - min) / range) * (height - pad * 2 - 16),
  }));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = d + ` L${pts[pts.length - 1].x},${height - 16} L${pts[0].x},${height - 16} Z`;

  return (
    <View>
      <Svg width={width} height={height}>
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = pad + pct * (height - pad * 2 - 16);
          return <Line key={i} x1={pad} y1={y} x2={width - pad} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />;
        })}
        <Path d={areaD} fill={color} opacity={0.06} />
        <Path d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={4} fill={color} />
        <Circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={7} fill={color} opacity={0.2} />
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: pad }}>
        {data.map((d) => (
          <Text key={d.day} style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)" }}>{d.day}</Text>
        ))}
      </View>
    </View>
  );
}

function RevenueDonut({ segments, size = 100 }: { segments: { pct: number; color: string }[]; size?: number }) {
  const r = (size - 14) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.04)" strokeWidth={12} fill="none" />
      {segments.map((seg, i) => {
        const dash = (seg.pct / 100) * circ;
        const gap = circ - dash;
        const el = (
          <Circle key={i} cx={cx} cy={cy} r={r} stroke={seg.color} strokeWidth={12} fill="none" strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-offset} strokeLinecap="round" transform={`rotate(-90, ${cx}, ${cy})`} />
        );
        offset += dash;
        return el;
      })}
    </Svg>
  );
}

function formatTimeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();
  const userName = user?.fullName || user?.firstName || "JDL";
  const avatarInitials = userName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() || "JD";
  const [refreshing, setRefreshing] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<"7d" | "30d" | "90d">("7d");
  const [showRevenue, setShowRevenue] = useState(true);
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [liveAgents, setLiveAgents] = useState<{ summary: { total: number; running: number; paused: number; totalPnl: number; avgWinRate: number }; agents: any[] } | null>(null);
  const [liveSummary, setLiveSummary] = useState<{ overview: { totalTransactions: number; totalAgentTrades: number; totalVolume: number; totalPnl: number; winRate: number; wins: number; losses: number }; recentAgentActivity: AgentActivityRecord[] } | null>(null);
  const [liveFlashCount, setLiveFlashCount] = useState<number | null>(null);
  const [dashboardData, setDashboardData] = useState<{
    portfolioHistory: Record<string, { day: string; value: number }[]>;
    portfolioStats: Record<string, { changePct: number; changeAmt: number; sharpe: number; label: string }>;
    aiEngines: { id: string; name: string; status: string; accuracy: number; trades: number; shapleyWeight: number }[];
    revenueBreakdown: { source: string; pct: number; amount: number; color: string }[];
  } | null>(null);
  const [audRate, setAudRate] = useState(DEFAULT_USD_TO_AUD);
  const formatCurrency = (val: number) => formatAUD(val, audRate);
  const formatCompact = (val: number) => formatAUDCompact(val, audRate);

  const fetchLiveData = useCallback(async () => {
    try {
      const [agentsRes, summaryRes, flashRes, dashRes, fxRes] = await Promise.allSettled([
        getAgents(),
        getActivitySummary(),
        getFlashLoanOpportunities(),
        getDashboardSummary(),
        getMarketFxRates(),
      ]);
      if (agentsRes.status === "fulfilled") setLiveAgents(agentsRes.value as any);
      if (summaryRes.status === "fulfilled") setLiveSummary(summaryRes.value as any);
      if (flashRes.status === "fulfilled") setLiveFlashCount((flashRes.value as any).count);
      if (dashRes.status === "fulfilled") setDashboardData(dashRes.value as any);
      if (fxRes.status === "fulfilled") setAudRate((fxRes.value as any).usdToAud);
    } catch {}
  }, []);

  useEffect(() => {
    Animated.timing(headerOpacity, { toValue: 1, duration: 800, useNativeDriver: true }).start();
    fetchLiveData();
  }, [fetchLiveData]);

  const watchdog = useScreenWatchdog({ fetch: fetchLiveData, screenName: "Dashboard", intervalMs: 30_000 });

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLiveData().finally(() => setRefreshing(false));
  }, [fetchLiveData]);

  const totalCapital = liveAgents?.agents?.reduce((s: number, a: any) => s + (a.capital || 0), 0) ?? 40000;
  const totalPnl = liveAgents?.summary.totalPnl ?? 0;
  const portfolioValue = totalCapital + totalPnl;
  const dailyPnl = liveSummary?.overview.totalPnl ?? 0;
  const dailyPct = portfolioValue > 0 ? Math.round((dailyPnl / (portfolioValue - dailyPnl)) * 10000) / 100 : 0;
  const liveWinRate = liveSummary?.overview.winRate ?? 0;
  const runningAgents = liveAgents?.summary.running ?? 0;
  const totalAgents = liveAgents?.summary.total ?? 0;
  const flashCount = liveFlashCount ?? 0;
  const dailyVolume = liveSummary?.overview.totalVolume ?? 0;
  const recentTrades: AgentActivityRecord[] = liveSummary?.recentAgentActivity?.slice(0, 4) ?? [];

  const liveRevenueBreakdown = dashboardData?.revenueBreakdown ?? [];
  const totalRevenue = liveRevenueBreakdown.reduce((s: number, r: any) => s + r.amount, 0);
  const chartData = dashboardData?.portfolioHistory?.[chartPeriod] ?? [];
  const rawStats = dashboardData?.portfolioStats?.[chartPeriod];
  const stats = rawStats ?? { changePct: 0, changeAmt: 0, sharpe: 0, label: chartPeriod };
  const liveAiEngines = dashboardData?.aiEngines ?? [];

  return (
    <ScrollView
      style={[st.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : 100, paddingTop: topPad }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <JDLHeader subtitle="Autonomous Trading" watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }} />
      <Animated.View style={[st.heroSection, { opacity: headerOpacity }]}>
        <View style={st.heroTop}>
          <View>
            <Text style={[st.greeting, { color: colors.mutedForeground }]}>Portfolio Value</Text>
            <View style={st.liveRow}>
              <GlowDot color={colors.profit} size={6} />
              <Text style={[st.liveText, { color: colors.profit }]}>Live</Text>
            </View>
          </View>
          <View style={[st.avatarSmall, { backgroundColor: colors.primary }]}>
            <Text style={st.avatarSmallText}>{avatarInitials}</Text>
          </View>
        </View>
        <CountUpText value={portfolioValue * audRate} prefix="A$" style={[st.heroValue, { color: colors.foreground }]} />
        <View style={st.changeRow}>
          <View style={[st.changePill, { backgroundColor: dailyPnl >= 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" }]}>
            <Feather name={dailyPnl >= 0 ? "trending-up" : "trending-down"} size={13} color={dailyPnl >= 0 ? colors.profit : colors.loss} />
            <Text style={[st.changeText, { color: dailyPnl >= 0 ? colors.profit : colors.loss }]}>
              {dailyPnl >= 0 ? "+" : ""}{formatCurrency(dailyPnl)} ({Math.abs(dailyPct)}%)
            </Text>
          </View>
          <Text style={[st.changeLabel, { color: colors.mutedForeground }]}>Cumulative P&L</Text>
        </View>
      </Animated.View>

      <AnimatedEntry delay={80}>
        <Card style={{ ...st.chartCard, marginHorizontal: 20 }} elevated>
          <View style={st.chartHeader}>
            <Text style={[st.chartTitle, { color: colors.foreground }]}>Performance</Text>
            <View style={st.chartPeriods}>
              {(["7d", "30d", "90d"] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[st.periodBtn, chartPeriod === p && { backgroundColor: colors.primary + "15" }]}
                  onPress={() => { setChartPeriod(p); Haptics.selectionAsync(); }}
                >
                  <Text style={[st.periodText, { color: chartPeriod === p ? colors.primary : colors.mutedForeground }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <PortfolioChart data={chartData} color={colors.primary} width={310} height={130} />
          <View style={st.chartStats}>
            <View style={st.chartStat}>
              <Text style={[st.chartStatValue, { color: colors.profit }]}>+{stats.changePct}%</Text>
              <Text style={[st.chartStatLabel, { color: colors.mutedForeground }]}>{stats.label}</Text>
            </View>
            <View style={st.chartStat}>
              <Text style={[st.chartStatValue, { color: colors.foreground }]}>{formatCompact(stats.changeAmt)}</Text>
              <Text style={[st.chartStatLabel, { color: colors.mutedForeground }]}>Change</Text>
            </View>
            <View style={st.chartStat}>
              <Text style={[st.chartStatValue, { color: colors.primary }]}>{stats.sharpe}</Text>
              <Text style={[st.chartStatLabel, { color: colors.mutedForeground }]}>Sharpe</Text>
            </View>
          </View>
        </Card>
      </AnimatedEntry>

      <AnimatedEntry delay={120}>
        <View style={st.metricsRow}>
          <View style={st.metricCol}>
            <Card elevated>
              <View style={st.metricHeader}>
                <View style={[st.metricIconWrap, { backgroundColor: "#22c55e15" }]}>
                  <Feather name="target" size={15} color="#22c55e" />
                </View>
                <View style={[st.metricBadge, { backgroundColor: "rgba(34,197,94,0.1)" }]}>
                  <Feather name="trending-up" size={9} color={colors.profit} />
                  <Text style={[st.metricBadgeText, { color: colors.profit }]}>+2.1%</Text>
                </View>
              </View>
              <Text style={[st.metricValue, { color: colors.foreground }]}>{liveWinRate > 0 ? `${liveWinRate}%` : "—"}</Text>
              <Text style={[st.metricLabel, { color: colors.mutedForeground }]}>Win Rate</Text>
            </Card>
          </View>
          <View style={st.metricCol}>
            <Card elevated>
              <View style={st.metricHeader}>
                <View style={[st.metricIconWrap, { backgroundColor: colors.primary + "15" }]}>
                  <Feather name="cpu" size={15} color={colors.primary} />
                </View>
              </View>
              <Text style={[st.metricValue, { color: colors.foreground }]}>{totalAgents > 0 ? `${runningAgents}/${totalAgents}` : "—"}</Text>
              <Text style={[st.metricLabel, { color: colors.mutedForeground }]}>Active Agents</Text>
            </Card>
          </View>
        </View>
      </AnimatedEntry>

      <AnimatedEntry delay={160}>
        <View style={st.metricsRow}>
          <View style={st.metricCol}>
            <Card elevated>
              <View style={st.metricHeader}>
                <View style={[st.metricIconWrap, { backgroundColor: "#8b5cf615" }]}>
                  <Feather name="bar-chart-2" size={15} color="#8b5cf6" />
                </View>
                <View style={[st.metricBadge, { backgroundColor: "rgba(34,197,94,0.1)" }]}>
                  <Feather name="trending-up" size={9} color={colors.profit} />
                  <Text style={[st.metricBadgeText, { color: colors.profit }]}>+12.3%</Text>
                </View>
              </View>
              <Text style={[st.metricValue, { color: colors.foreground }]}>{dailyVolume > 0 ? formatCompact(dailyVolume) : "—"}</Text>
              <Text style={[st.metricLabel, { color: colors.mutedForeground }]}>Total Volume</Text>
            </Card>
          </View>
          <View style={st.metricCol}>
            <Card elevated>
              <View style={st.metricHeader}>
                <View style={[st.metricIconWrap, { backgroundColor: "#f59e0b15" }]}>
                  <Feather name="zap" size={15} color="#f59e0b" />
                </View>
              </View>
              <Text style={[st.metricValue, { color: colors.foreground }]}>{flashCount > 0 ? `${flashCount} Live` : "—"}</Text>
              <Text style={[st.metricLabel, { color: colors.mutedForeground }]}>Flash Loans</Text>
            </Card>
          </View>
        </View>
      </AnimatedEntry>

      <AnimatedEntry delay={200}>
        <Card style={{ ...st.revenueCard, marginHorizontal: 20 }} elevated>
          <TouchableOpacity style={st.revenueHeader} onPress={() => { setShowRevenue(!showRevenue); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} activeOpacity={0.7}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[st.revenueIconWrap, { backgroundColor: "#8b5cf615" }]}>
                <Feather name="pie-chart" size={14} color="#8b5cf6" />
              </View>
              <Text style={[st.revenueTitle, { color: colors.foreground }]}>Revenue Breakdown</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[st.revenueTotalText, { color: colors.profit }]}>{formatCurrency(totalRevenue)}</Text>
              <Feather name={showRevenue ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
            </View>
          </TouchableOpacity>
          {showRevenue && (
            <View style={st.revenueBody}>
              <View style={st.donutRow}>
                <RevenueDonut segments={liveRevenueBreakdown.map((r: any) => ({ pct: r.pct, color: r.color }))} size={110} />
                <View style={st.revenueLegend}>
                  {liveRevenueBreakdown.map((r: any) => (
                    <View key={r.source} style={st.legendRow}>
                      <View style={[st.legendDot, { backgroundColor: r.color }]} />
                      <Text style={[st.legendSource, { color: colors.foreground }]}>{r.source}</Text>
                      <Text style={[st.legendPct, { color: colors.mutedForeground }]}>{r.pct}%</Text>
                      <Text style={[st.legendAmt, { color: colors.foreground }]}>{formatCompact(r.amount)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          )}
        </Card>
      </AnimatedEntry>

      <AnimatedEntry delay={250}>
        <View style={st.sectionHeader}>
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>AI Engine Health</Text>
          <View style={st.compositeScore}>
            <Text style={[st.compositeLabel, { color: colors.mutedForeground }]}>Composite</Text>
            <Text style={[st.compositeValue, { color: colors.primary }]}>
              {(() => { const c = liveAiEngines.find((e: any) => e.id === "composite"); return c ? `${(c.accuracy * 100).toFixed(1)}%` : "—"; })()}
            </Text>
          </View>
        </View>
      </AnimatedEntry>

      <AnimatedEntry delay={280}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.enginesScroll}>
          {liveAiEngines.map((engine: any) => (
            <Card key={engine.id} style={st.engineCard} elevated>
              <View style={st.engineTop}>
                <Text style={[st.engineName, { color: colors.foreground }]} numberOfLines={1}>{engine.name}</Text>
                <StatusBadge status={engine.status} />
              </View>
              <View style={st.engineCenter}>
                <ProgressRing progress={engine.accuracy * 100} size={72} strokeWidth={3} color={colors.primary} />
              </View>
              <View style={st.engineBottom}>
                <View style={st.engineStat}>
                  <Text style={[st.engineStatValue, { color: colors.foreground }]}>{engine.trades}</Text>
                  <Text style={[st.engineStatLabel, { color: colors.mutedForeground }]}>Trades</Text>
                </View>
                <View style={[st.engineDivider, { backgroundColor: colors.border }]} />
                <View style={st.engineStat}>
                  <Text style={[st.engineStatValue, { color: "#8b5cf6" }]}>{engine.shapleyWeight.toFixed(2)}</Text>
                  <Text style={[st.engineStatLabel, { color: colors.mutedForeground }]}>{engine.id === "composite" ? "Avg \u03C6" : "Shapley \u03C6"}</Text>
                </View>
              </View>
            </Card>
          ))}
        </ScrollView>
      </AnimatedEntry>

      <AnimatedEntry delay={320}>
        <View style={st.sectionHeader}>
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>Recent Trades</Text>
          <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/activity" as any); }}>
            <Text style={[st.sectionAction, { color: colors.primary }]}>View All</Text>
          </TouchableOpacity>
        </View>
      </AnimatedEntry>

      <View style={st.tradesSection}>
        {recentTrades.length === 0 ? (
          <AnimatedEntry delay={360}>
            <Card style={st.tradeCard}>
              <Text style={[st.tradeTime, { color: colors.mutedForeground, textAlign: "center", paddingVertical: 8 }]}>Loading live trades…</Text>
            </Card>
          </AnimatedEntry>
        ) : recentTrades.map((trade, i) => {
          const isEntry = trade.action?.includes("entry") || trade.action?.includes("buy\u2192sell") || trade.action?.includes("arb");
          return (
            <AnimatedEntry key={trade.txHash + i} delay={360 + i * 50}>
              <Card style={st.tradeCard}>
                <View style={st.tradeRow}>
                  <View style={st.tradeLeft}>
                    <View style={[st.tradeIcon, { backgroundColor: isEntry ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)" }]}>
                      <Feather name={isEntry ? "arrow-down-left" : "arrow-up-right"} size={15} color={isEntry ? colors.profit : colors.loss} />
                    </View>
                    <View>
                      <Text style={[st.tradePair, { color: colors.foreground }]}>{trade.pair}</Text>
                      <Text style={[st.tradeTime, { color: colors.mutedForeground }]}>{formatTimeAgo(trade.timestamp)} · {trade.agentName}</Text>
                    </View>
                  </View>
                  <View style={st.tradeRight}>
                    <Text style={[st.tradePnl, { color: trade.pnl >= 0 ? colors.profit : colors.loss }]}>
                      {trade.pnl >= 0 ? "+" : ""}{formatCurrency(trade.pnl)}
                    </Text>
                    <Text style={[st.tradeAmount, { color: colors.mutedForeground }]}>
                      {trade.amount?.toFixed(4)} @ {formatCurrency(trade.entryPrice)}
                    </Text>
                  </View>
                </View>
              </Card>
            </AnimatedEntry>
          );
        })}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  heroSection: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  liveText: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  avatarSmall: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarSmallText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  greeting: { fontSize: 13, fontFamily: "Inter_500Medium" },
  heroValue: { fontSize: 36, fontFamily: "Inter_700Bold", marginBottom: 8, letterSpacing: -1 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  changePill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 5 },
  changeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  changeLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  chartCard: { padding: 16, marginTop: 16 },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  chartTitle: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  chartPeriods: { flexDirection: "row", gap: 4 },
  periodBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  periodText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  chartStats: { flexDirection: "row", justifyContent: "space-around", marginTop: 12 },
  chartStat: { alignItems: "center" },
  chartStatValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  chartStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  metricsRow: { flexDirection: "row", paddingHorizontal: 20, gap: 12, marginTop: 12 },
  metricCol: { flex: 1 },
  metricHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  metricIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  metricBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, gap: 3 },
  metricBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  metricValue: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 2, letterSpacing: -0.5 },
  metricLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  revenueCard: { padding: 16, marginTop: 16 },
  revenueHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  revenueIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  revenueTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  revenueTotalText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  revenueBody: { marginTop: 16 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  revenueLegend: { flex: 1, gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendSource: { fontSize: 11, fontFamily: "Inter_500Medium", flex: 1 },
  legendPct: { fontSize: 10, fontFamily: "Inter_400Regular", width: 28, textAlign: "right" },
  legendAmt: { fontSize: 11, fontFamily: "Inter_700Bold", width: 50, textAlign: "right" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 12, marginTop: 24 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sectionAction: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  compositeScore: { alignItems: "flex-end" },
  compositeLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  compositeValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  enginesScroll: { paddingHorizontal: 20, gap: 12 },
  engineCard: { width: 170, padding: 14 },
  engineTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  engineName: { fontSize: 12, fontFamily: "Inter_600SemiBold", flex: 1, marginRight: 4 },
  engineCenter: { alignItems: "center", marginBottom: 12 },
  engineBottom: { flexDirection: "row", alignItems: "center" },
  engineStat: { flex: 1, alignItems: "center" },
  engineStatValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  engineStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  engineDivider: { width: 1, height: 24 },
  tradesSection: { paddingHorizontal: 20, gap: 8 },
  tradeCard: { padding: 14 },
  tradeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tradeLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  tradeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tradePair: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  tradeTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  tradeRight: { alignItems: "flex-end" },
  tradePnl: { fontSize: 15, fontFamily: "Inter_700Bold" },
  tradeAmount: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
});
