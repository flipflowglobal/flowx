import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Linking,
  Modal,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Svg, { Rect, Line, Text as SvgText, Circle, Path, Defs, LinearGradient, Stop } from "react-native-svg";
import { JDLHeader } from "@/components/JDLHeader";
import { useScreenWatchdog } from "@/hooks/useScreenWatchdog";
import {
  getActivitySummary,
  getActivityTransactions,
  getAgentActivityRecords,
  getPnlChart,
  getVolumeChart,
  getFeeLedger,
  getRevenueSimulation,
  getAgentWallets,
  type ActivityTransaction,
  type AgentActivityRecord,
  type AgentWalletListItem,
} from "@/lib/api";
import { chainColors, chainIcons } from "@/lib/mockData";
import { DEFAULT_USD_TO_AUD } from "@/lib/currency";
import { getMarketFxRates } from "@/lib/api";

let _activityAudRate = DEFAULT_USD_TO_AUD;

const { width: SCREEN_W } = Dimensions.get("window");
const CHART_W = SCREEN_W - 64;
const CHART_H = 160;

const C = {
  bg: "#0a0e1a",
  card: "#0d1225",
  elevated: "#111832",
  border: "rgba(255,255,255,0.06)",
  borderLight: "rgba(255,255,255,0.1)",
  primary: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  orange: "#f59e0b",
  purple: "#8b5cf6",
  cyan: "#06b6d4",
  pink: "#ec4899",
  white: "#ffffff",
  muted: "#64748b",
  dimText: "#94a3b8",
  faint: "rgba(255,255,255,0.04)",
};

type TabKey = "overview" | "transactions" | "agents" | "fees" | "revenue";

interface OverviewData {
  totalTransactions: number;
  totalAgentTrades: number;
  totalVolume: number;
  totalPnl: number;
  totalFeesPaid: number;
  winRate: number;
  wins: number;
  losses: number;
  isEmpty?: boolean;
}

interface TxSummary {
  totalVolume: number;
  totalFees: number;
  totalGas: number;
  confirmed: number;
  pending: number;
  failed: number;
}

interface AgentSummary {
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  totalPnl: number;
  totalGasCost: number;
  totalFeesDeducted: number;
  netPnl: number;
}

interface PnlPoint {
  date: string;
  pnl: number;
  cumulative: number;
  volume: number;
  fees: number;
}

interface VolPoint {
  date: string;
  total: number;
  byChain: Record<string, number>;
}

interface FeeEntry {
  id: string;
  txHash: string;
  feeTxHash: string;
  fromWallet: string;
  toWallet: string;
  originalAmount: number;
  feeAmount: number;
  netAmount: number;
  chain: string;
  token: string;
  type: string;
  timestamp: string;
}

interface FeeSummary {
  totalFeesPaid: number;
  totalTransactionVolume: number;
  transactionCount: number;
  feeRate: string;
  feeDestination: string;
}

function fmt(n: number): string {
  const aud = n * _activityAudRate;
  if (Math.abs(aud) >= 1_000_000) return `A$${(aud / 1_000_000).toFixed(2)}M`;
  if (Math.abs(aud) >= 1_000) return `A$${(aud / 1_000).toFixed(1)}K`;
  return `A$${aud.toFixed(2)}`;
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatusDot({ status }: { status: string }) {
  const color = status === "confirmed" ? C.green : status === "pending" ? C.orange : C.red;
  return <View style={[styles.statusDot, { backgroundColor: color }]} />;
}

function ResultBadge({ result }: { result: string }) {
  const color = result === "win" ? C.green : result === "loss" ? C.red : C.orange;
  const label = result === "win" ? "WIN" : result === "loss" ? "LOSS" : "EVEN";
  return (
    <View style={[styles.resultBadge, { backgroundColor: `${color}15` }]}>
      <Text style={[styles.resultBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

function ChainBadge({ chain }: { chain: string }) {
  const color = chainColors[chain] || C.primary;
  const icon = chainIcons[chain] || chain.charAt(0).toUpperCase();
  return (
    <View style={[styles.chainBadge, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
      <Text style={[styles.chainBadgeText, { color }]}>{icon}</Text>
      <Text style={[styles.chainBadgeName, { color }]}>{chain}</Text>
    </View>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colorMap: Record<string, string> = {
    trade: C.primary,
    transfer: C.cyan,
    fee: C.orange,
    revenue: C.green,
    "flash-loan": C.purple,
    deposit: C.green,
    withdrawal: C.red,
  };
  const color = colorMap[type] || C.muted;
  return (
    <View style={[styles.typeBadge, { backgroundColor: `${color}15` }]}>
      <Text style={[styles.typeBadgeText, { color }]}>{type.replace("-", " ").toUpperCase()}</Text>
    </View>
  );
}

function SummaryCard({ icon, label, value, color, sub }: { icon: string; label: string; value: string; color: string; sub?: string }) {
  return (
    <View style={[styles.summaryCard, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <View style={[styles.summaryIconWrap, { backgroundColor: `${color}15` }]}>
        <Feather name={icon as any} size={16} color={color} />
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      {sub ? <Text style={styles.summarySub}>{sub}</Text> : null}
    </View>
  );
}

function PnlChart({ data }: { data: PnlPoint[] }) {
  if (!data.length) return null;
  const maxVal = Math.max(...data.map((d) => d.cumulative), 1);
  const minVal = Math.min(...data.map((d) => d.cumulative), 0);
  const range = maxVal - minVal || 1;
  const step = CHART_W / (data.length - 1);
  const padTop = 20;
  const padBot = 30;
  const chartH = CHART_H - padTop - padBot;

  const points = data.map((d, i) => ({
    x: i * step,
    y: padTop + chartH - ((d.cumulative - minVal) / range) * chartH,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${points[points.length - 1].x.toFixed(1)},${CHART_H - padBot} L${points[0].x.toFixed(1)},${CHART_H - padBot} Z`;

  const isPositive = data[data.length - 1].cumulative >= 0;
  const lineColor = isPositive ? C.green : C.red;

  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>Cumulative P&L (30 Days)</Text>
      <Svg width={CHART_W} height={CHART_H}>
        <Defs>
          <LinearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lineColor} stopOpacity="0.3" />
            <Stop offset="1" stopColor={lineColor} stopOpacity="0.0" />
          </LinearGradient>
        </Defs>
        <Line x1={0} y1={padTop + chartH / 2} x2={CHART_W} y2={padTop + chartH / 2} stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray="4,4" />
        <Path d={areaD} fill="url(#pnlGrad)" />
        <Path d={pathD} stroke={lineColor} strokeWidth={2} fill="none" />
        {points.filter((_, i) => i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)).map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={lineColor} />
        ))}
        {data.filter((_, i) => i % 6 === 0 || i === data.length - 1).map((d, idx) => {
          const i = idx === 0 ? 0 : data.indexOf(d);
          return (
            <SvgText key={i} x={points[i].x} y={CHART_H - 8} fill={C.muted} fontSize={9} textAnchor="middle" fontFamily="Inter_500Medium">
              {d.date.slice(5)}
            </SvgText>
          );
        })}
        <SvgText x={4} y={padTop - 4} fill={C.dimText} fontSize={9} fontFamily="Inter_500Medium">
          {fmt(maxVal)}
        </SvgText>
        <SvgText x={4} y={CHART_H - padBot + 12} fill={C.dimText} fontSize={9} fontFamily="Inter_500Medium">
          {fmt(minVal)}
        </SvgText>
      </Svg>
    </View>
  );
}

function VolumeChart({ data }: { data: VolPoint[] }) {
  if (!data.length) return null;
  const maxVol = Math.max(...data.map((d) => d.total), 1);
  const barW = Math.max((CHART_W - data.length * 4) / data.length, 8);
  const padBot = 28;
  const chartH = 130 - padBot;

  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>Daily Volume (14 Days)</Text>
      <Svg width={CHART_W} height={130}>
        {data.map((d, i) => {
          const h = (d.total / maxVol) * chartH;
          const x = i * (barW + 4);
          return (
            <React.Fragment key={i}>
              <Defs>
                <LinearGradient id={`vg${i}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={C.primary} stopOpacity="0.9" />
                  <Stop offset="1" stopColor={C.primary} stopOpacity="0.3" />
                </LinearGradient>
              </Defs>
              <Rect x={x} y={chartH - h} width={barW} height={h} rx={3} fill={`url(#vg${i})`} />
              {i % 3 === 0 || i === data.length - 1 ? (
                <SvgText x={x + barW / 2} y={130 - 8} fill={C.muted} fontSize={8} textAnchor="middle" fontFamily="Inter_500Medium">
                  {d.date.slice(5)}
                </SvgText>
              ) : null}
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

function WinLossChart({ wins, losses, breakeven }: { wins: number; losses: number; breakeven: number }) {
  const total = wins + losses + breakeven;
  if (total === 0) return null;
  const wPct = (wins / total) * 100;
  const lPct = (losses / total) * 100;
  const bPct = (breakeven / total) * 100;
  const radius = 45;
  const cx = 55;
  const cy = 55;
  const circumference = 2 * Math.PI * radius;

  const wLen = (wPct / 100) * circumference;
  const lLen = (lPct / 100) * circumference;
  const bLen = (bPct / 100) * circumference;

  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>Win/Loss Distribution</Text>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Svg width={110} height={110}>
          <Circle cx={cx} cy={cy} r={radius} stroke="rgba(255,255,255,0.06)" strokeWidth={10} fill="none" />
          <Circle cx={cx} cy={cy} r={radius} stroke={C.green} strokeWidth={10} fill="none" strokeDasharray={`${wLen} ${circumference - wLen}`} strokeDashoffset={circumference * 0.25} strokeLinecap="round" />
          <Circle cx={cx} cy={cy} r={radius} stroke={C.red} strokeWidth={10} fill="none" strokeDasharray={`${lLen} ${circumference - lLen}`} strokeDashoffset={circumference * 0.25 - wLen} strokeLinecap="round" />
          <Circle cx={cx} cy={cy} r={radius} stroke={C.orange} strokeWidth={10} fill="none" strokeDasharray={`${bLen} ${circumference - bLen}`} strokeDashoffset={circumference * 0.25 - wLen - lLen} strokeLinecap="round" />
          <SvgText x={cx} y={cy - 4} fill={C.white} fontSize={18} fontWeight="700" textAnchor="middle" fontFamily="Inter_700Bold">
            {wPct.toFixed(0)}%
          </SvgText>
          <SvgText x={cx} y={cy + 12} fill={C.muted} fontSize={10} textAnchor="middle" fontFamily="Inter_500Medium">
            Win Rate
          </SvgText>
        </Svg>
        <View style={{ marginLeft: 16, flex: 1 }}>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: C.green }]} />
            <Text style={styles.legendLabel}>Wins</Text>
            <Text style={[styles.legendValue, { color: C.green }]}>{wins}</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: C.red }]} />
            <Text style={styles.legendLabel}>Losses</Text>
            <Text style={[styles.legendValue, { color: C.red }]}>{losses}</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: C.orange }]} />
            <Text style={styles.legendLabel}>Breakeven</Text>
            <Text style={[styles.legendValue, { color: C.orange }]}>{breakeven}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function AgentPnlBars({ byAgent }: { byAgent: Record<string, { wins: number; losses: number; pnl: number; trades: number }> }) {
  const entries = Object.entries(byAgent).sort((a, b) => b[1].pnl - a[1].pnl);
  const maxPnl = Math.max(...entries.map(([, v]) => Math.abs(v.pnl)), 1);

  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>P&L by Agent</Text>
      {entries.map(([name, data]) => {
        const pct = (Math.abs(data.pnl) / maxPnl) * 100;
        const isPos = data.pnl >= 0;
        const color = isPos ? C.green : C.red;
        const winRate = data.trades > 0 ? Math.round((data.wins / data.trades) * 100) : 0;
        return (
          <View key={name} style={styles.agentBarRow}>
            <View style={styles.agentBarHeader}>
              <Text style={styles.agentBarName} numberOfLines={1}>{name}</Text>
              <Text style={[styles.agentBarPnl, { color }]}>{isPos ? "+" : ""}{fmt(data.pnl)}</Text>
            </View>
            <View style={styles.agentBarTrack}>
              <View style={[styles.agentBarFill, { width: `${Math.max(pct, 4)}%`, backgroundColor: color }]} />
            </View>
            <View style={styles.agentBarMeta}>
              <Text style={styles.agentBarMetaText}>{data.trades} trades</Text>
              <Text style={styles.agentBarMetaText}>{winRate}% win</Text>
              <Text style={styles.agentBarMetaText}>{data.wins}W / {data.losses}L</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function WalletBalanceList() {
  const [wallets, setWallets] = useState<AgentWalletListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAgentWallets()
      .then((r) => setWallets(r.wallets))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const primaryChain = (w: AgentWalletListItem) => w.chains?.[0] || "ethereum";
  const shortAddr = (addr: string) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";

  if (loading) {
    return (
      <View style={[styles.section, { alignItems: "center", paddingVertical: 28 }]}>
        <ActivityIndicator size="small" color={C.primary} />
        <Text style={[styles.walletAddr, { marginTop: 8 }]}>Loading wallets…</Text>
      </View>
    );
  }

  if (!wallets.length) {
    return (
      <View style={[styles.section, { alignItems: "center", paddingVertical: 24 }]}>
        <Feather name="inbox" size={28} color={C.muted} />
        <Text style={[styles.walletAddr, { marginTop: 8, color: C.muted }]}>No agent wallets yet</Text>
        <Text style={[styles.walletAddr, { color: C.muted, fontSize: 11 }]}>Create an agent to generate a wallet</Text>
      </View>
    );
  }

  const totalNet = wallets.reduce((s, w) => s + (w.wallet?.netRevenue || 0), 0);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Agent Wallets</Text>
      {wallets.map((w) => {
        const chain = primaryChain(w);
        return (
          <View key={w.agentId} style={styles.walletRow}>
            <View style={styles.walletLeft}>
              <View style={[styles.walletChainIcon, { backgroundColor: `${chainColors[chain] || C.primary}20` }]}>
                <Text style={{ color: chainColors[chain] || C.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>
                  {chainIcons[chain] || chain.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.walletName}>{w.agentName}</Text>
                <Text style={styles.walletAddr}>{shortAddr(w.wallet?.address || "")}</Text>
              </View>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.walletBalance, { color: (w.wallet?.netRevenue || 0) >= 0 ? C.green : C.red }]}>
                {(w.wallet?.netRevenue || 0) >= 0 ? "+" : ""}{fmt(w.wallet?.netRevenue || 0)}
              </Text>
              <Text style={styles.walletChain}>{chain}</Text>
            </View>
          </View>
        );
      })}
      <View style={styles.walletTotalRow}>
        <Text style={styles.walletTotalLabel}>Total Net Revenue</Text>
        <Text style={[styles.walletTotalValue, { color: totalNet >= 0 ? C.green : C.red }]}>{totalNet >= 0 ? "+" : ""}{fmt(totalNet)}</Text>
      </View>
    </View>
  );
}

export default function ActivityScreen() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [transactions, setTransactions] = useState<ActivityTransaction[]>([]);
  const [txSummary, setTxSummary] = useState<TxSummary | null>(null);
  const [agentRecords, setAgentRecords] = useState<AgentActivityRecord[]>([]);
  const [agentSummary, setAgentSummary] = useState<AgentSummary | null>(null);
  const [byAgent, setByAgent] = useState<Record<string, { wins: number; losses: number; breakeven: number; pnl: number; trades: number }>>({});
  const [pnlData, setPnlData] = useState<PnlPoint[]>([]);
  const [volData, setVolData] = useState<VolPoint[]>([]);
  const [fees, setFees] = useState<FeeEntry[]>([]);
  const [feeSummary, setFeeSummary] = useState<FeeSummary | null>(null);

  const [txDetailModal, setTxDetailModal] = useState<ActivityTransaction | null>(null);
  const [agentDetailModal, setAgentDetailModal] = useState<AgentActivityRecord | null>(null);
  const [revSim, setRevSim] = useState<Awaited<ReturnType<typeof getRevenueSimulation>> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [sumRes, txRes, agRes, pnlRes, volRes, feeRes, revRes] = await Promise.all([
        getActivitySummary(),
        getActivityTransactions(),
        getAgentActivityRecords(),
        getPnlChart(),
        getVolumeChart(),
        getFeeLedger(),
        getRevenueSimulation().catch(() => null),
      ]);
      setOverview(sumRes.overview);
      setTransactions(txRes.transactions);
      setTxSummary(txRes.summary);
      setAgentRecords(agRes.activity);
      setAgentSummary(agRes.summary);
      setByAgent(agRes.byAgent);
      setPnlData(pnlRes.data);
      setVolData(volRes.data);
      setFees(feeRes.fees);
      setFeeSummary(feeRes.summary);
      if (revRes) setRevSim(revRes);
    } catch (e) {
      console.warn("Activity load error", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    getMarketFxRates().then(r => { _activityAudRate = r.usdToAud; }).catch(() => {});
  }, [loadData]);

  const watchdog = useScreenWatchdog({ fetch: loadData, screenName: "Activity", intervalMs: 30_000 });

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "overview", label: "Overview", icon: "activity" },
    { key: "transactions", label: "Transactions", icon: "list" },
    { key: "agents", label: "Agent Activity", icon: "cpu" },
    { key: "fees", label: "Fees", icon: "percent" },
    { key: "revenue", label: "Revenue", icon: "dollar-sign" },
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <JDLHeader subtitle="Activity" watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Activity</Text>
          <Text style={styles.headerSub}>Transactions, Agent Performance & System Fees</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.7}
            >
              <Feather name={t.icon as any} size={14} color={tab === t.key ? C.white : C.muted} />
              <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingWrap}>
            <Feather name="loader" size={24} color={C.primary} />
            <Text style={styles.loadingText}>Loading activity data...</Text>
          </View>
        ) : (
          <>
            {tab === "overview" && (
              <>
                {overview && (
                  <View style={styles.summaryGrid}>
                    <SummaryCard icon="trending-up" label="Total Volume" value={fmt(overview.totalVolume)} color={C.primary} sub={`${overview.totalTransactions} transactions`} />
                    <SummaryCard icon="dollar-sign" label="Total P&L" value={`${overview.totalPnl >= 0 ? "+" : ""}${fmt(overview.totalPnl)}`} color={overview.totalPnl >= 0 ? C.green : C.red} sub={`${overview.winRate}% win rate`} />
                    <SummaryCard icon="percent" label="Fees Paid" value={fmt(overview.totalFeesPaid)} color={C.orange} sub="0.75% system fee" />
                    <SummaryCard icon="cpu" label="Agent Trades" value={overview.totalAgentTrades.toString()} color={C.purple} sub={`${overview.wins}W / ${overview.losses}L`} />
                  </View>
                )}
                {overview?.isEmpty && (
                  <View style={[styles.section, { alignItems: "center", paddingVertical: 24 }]}>
                    <Feather name="activity" size={32} color={C.muted} />
                    <Text style={[styles.sectionTitle, { color: C.muted, marginTop: 12, textAlign: "center" }]}>No trades recorded yet</Text>
                    <Text style={[styles.loadingText, { textAlign: "center", marginTop: 6, paddingHorizontal: 16 }]}>
                      Your agents will record trades here once they start executing on-chain. Start an agent to begin.
                    </Text>
                  </View>
                )}

                <WalletBalanceList />
                <PnlChart data={pnlData} />
                <VolumeChart data={volData} />

                {agentSummary && (
                  <WinLossChart wins={agentSummary.wins} losses={agentSummary.losses} breakeven={agentSummary.breakeven} />
                )}
                <AgentPnlBars byAgent={byAgent} />

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Recent Transactions</Text>
                  {transactions.slice(0, 8).map((tx) => (
                    <TouchableOpacity key={tx.id} style={styles.txRow} onPress={() => setTxDetailModal(tx)} activeOpacity={0.7}>
                      <View style={styles.txLeft}>
                        <StatusDot status={tx.status} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.txDesc} numberOfLines={1}>{tx.description}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
                            <TypeBadge type={tx.type} />
                            <Text style={styles.txTime}>{timeAgo(tx.timestamp)}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.txAmount}>{tx.amount.toFixed(4)} {tx.token}</Text>
                        <Text style={styles.txAmountUsd}>{fmt(tx.amountUsd)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {tab === "transactions" && (
              <>
                <View style={[styles.paperDisclaimer, { backgroundColor: "rgba(139,92,246,0.07)", borderColor: "#8b5cf625" }]}>
                  <Feather name="info" size={12} color="#8b5cf6" />
                  <Text style={[styles.paperDisclaimerText, { color: "#8b5cf6" }]}>
                    Paper Trading — transactions shown are simulated. Agent algorithms run on live market data but no real funds are moved.
                  </Text>
                </View>
                {txSummary && (
                  <View style={styles.summaryGrid}>
                    <SummaryCard icon="check-circle" label="Confirmed" value={txSummary.confirmed.toString()} color={C.green} />
                    <SummaryCard icon="clock" label="Pending" value={txSummary.pending.toString()} color={C.orange} />
                    <SummaryCard icon="x-circle" label="Failed" value={txSummary.failed.toString()} color={C.red} />
                    <SummaryCard icon="zap" label="Gas Spent" value={fmt(txSummary.totalGas)} color={C.cyan} />
                  </View>
                )}

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>All Transactions ({transactions.length})</Text>
                  {transactions.map((tx) => (
                    <TouchableOpacity key={tx.id} style={styles.txCard} onPress={() => setTxDetailModal(tx)} activeOpacity={0.7}>
                      <View style={styles.txCardHeader}>
                        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                          <StatusDot status={tx.status} />
                          <Text style={styles.txCardTitle} numberOfLines={1}>{tx.description}</Text>
                        </View>
                        <Feather name="external-link" size={14} color={C.muted} />
                      </View>
                      <View style={styles.txCardBody}>
                        <View style={styles.txCardField}>
                          <Text style={styles.txCardFieldLabel}>Amount</Text>
                          <Text style={styles.txCardFieldValue}>{tx.amount.toFixed(4)} {tx.token}</Text>
                        </View>
                        <View style={styles.txCardField}>
                          <Text style={styles.txCardFieldLabel}>Value</Text>
                          <Text style={styles.txCardFieldValue}>{fmt(tx.amountUsd)}</Text>
                        </View>
                        <View style={styles.txCardField}>
                          <Text style={styles.txCardFieldLabel}>Chain</Text>
                          <ChainBadge chain={tx.chain} />
                        </View>
                        <View style={styles.txCardField}>
                          <Text style={styles.txCardFieldLabel}>Type</Text>
                          <TypeBadge type={tx.type} />
                        </View>
                      </View>
                      <View style={styles.txCardFooter}>
                        <Text style={styles.txCardHash} numberOfLines={1}>TX: {shortAddr(tx.txHash)}</Text>
                        <Text style={styles.txCardTime}>{timeAgo(tx.timestamp)}</Text>
                      </View>
                      {tx.feeAmount ? (
                        <View style={styles.txCardFee}>
                          <Feather name="percent" size={10} color={C.orange} />
                          <Text style={styles.txCardFeeText}>System Fee: {fmt(tx.feeAmount)} → {shortAddr(tx.feeDestination || "")}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {tab === "agents" && (
              <>
                {agentSummary && (
                  <View style={styles.summaryGrid}>
                    <SummaryCard icon="trending-up" label="Net P&L" value={`${agentSummary.netPnl >= 0 ? "+" : ""}${fmt(agentSummary.netPnl)}`} color={agentSummary.netPnl >= 0 ? C.green : C.red} />
                    <SummaryCard icon="target" label="Win Rate" value={`${agentSummary.winRate}%`} color={C.primary} sub={`${agentSummary.wins}W / ${agentSummary.losses}L`} />
                    <SummaryCard icon="zap" label="Gas Cost" value={fmt(agentSummary.totalGasCost)} color={C.cyan} />
                    <SummaryCard icon="percent" label="Fees Deducted" value={fmt(agentSummary.totalFeesDeducted)} color={C.orange} />
                  </View>
                )}

                <WinLossChart wins={agentSummary?.wins || 0} losses={agentSummary?.losses || 0} breakeven={agentSummary?.breakeven || 0} />
                <AgentPnlBars byAgent={byAgent} />

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Agent Trade Log ({agentRecords.length})</Text>
                  {agentRecords.map((rec, idx) => (
                    <TouchableOpacity key={idx} style={styles.agentCard} onPress={() => setAgentDetailModal(rec)} activeOpacity={0.7}>
                      <View style={styles.agentCardHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.agentCardName}>{rec.agentName}</Text>
                          <Text style={styles.agentCardStrategy}>{rec.strategy}</Text>
                        </View>
                        <ResultBadge result={rec.result} />
                      </View>
                      <View style={styles.agentCardBody}>
                        <View style={styles.agentCardField}>
                          <Text style={styles.agentCardFieldLabel}>Pair</Text>
                          <Text style={styles.agentCardFieldValue}>{rec.pair}</Text>
                        </View>
                        <View style={styles.agentCardField}>
                          <Text style={styles.agentCardFieldLabel}>Action</Text>
                          <Text style={styles.agentCardFieldValue}>{rec.action}</Text>
                        </View>
                        <View style={styles.agentCardField}>
                          <Text style={styles.agentCardFieldLabel}>P&L</Text>
                          <Text style={[styles.agentCardFieldValue, { color: rec.pnl >= 0 ? C.green : C.red }]}>
                            {rec.pnl >= 0 ? "+" : ""}{fmt(rec.pnl)} ({rec.pnlPercent}%)
                          </Text>
                        </View>
                        <View style={styles.agentCardField}>
                          <Text style={styles.agentCardFieldLabel}>Chain</Text>
                          <ChainBadge chain={rec.chain} />
                        </View>
                      </View>
                      <View style={styles.agentCardFooter}>
                        <Text style={styles.agentCardMeta}>
                          Entry: {fmt(rec.entryPrice)} → Exit: {fmt(rec.exitPrice)}
                        </Text>
                        <Text style={styles.agentCardMeta}>Duration: {rec.duration}</Text>
                      </View>
                      <View style={styles.txCardFooter}>
                        <Text style={styles.txCardHash}>TX: {shortAddr(rec.txHash)}</Text>
                        <Text style={styles.txCardTime}>{timeAgo(rec.timestamp)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {tab === "fees" && (
              <>
                {feeSummary && (
                  <View style={styles.feeOverviewCard}>
                    <View style={styles.feeOverviewHeader}>
                      <Feather name="shield" size={20} color={C.orange} />
                      <Text style={styles.feeOverviewTitle}>System Fee Summary</Text>
                    </View>
                    <View style={styles.feeOverviewGrid}>
                      <View style={styles.feeOverviewItem}>
                        <Text style={styles.feeOverviewLabel}>Fee Rate</Text>
                        <Text style={[styles.feeOverviewValue, { color: C.orange }]}>{feeSummary.feeRate}</Text>
                      </View>
                      <View style={styles.feeOverviewItem}>
                        <Text style={styles.feeOverviewLabel}>Total Fees Paid</Text>
                        <Text style={[styles.feeOverviewValue, { color: C.red }]}>{fmt(feeSummary.totalFeesPaid)}</Text>
                      </View>
                      <View style={styles.feeOverviewItem}>
                        <Text style={styles.feeOverviewLabel}>Transaction Volume</Text>
                        <Text style={[styles.feeOverviewValue, { color: C.primary }]}>{fmt(feeSummary.totalTransactionVolume)}</Text>
                      </View>
                      <View style={styles.feeOverviewItem}>
                        <Text style={styles.feeOverviewLabel}>Total Transactions</Text>
                        <Text style={styles.feeOverviewValue}>{feeSummary.transactionCount}</Text>
                      </View>
                    </View>
                    <View style={styles.feeDestRow}>
                      <Feather name="arrow-right" size={12} color={C.muted} />
                      <Text style={styles.feeDestText}>Destination: {shortAddr(feeSummary.feeDestination)}</Text>
                    </View>
                  </View>
                )}

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Fee Ledger ({fees.length})</Text>
                  {fees.map((f) => (
                    <View key={f.id} style={styles.feeCard}>
                      <View style={styles.feeCardHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.feeCardType}>{f.type.replace("-", " ").toUpperCase()}</Text>
                          <Text style={styles.feeCardToken}>{f.token} on {f.chain}</Text>
                        </View>
                        <Text style={[styles.feeCardAmount, { color: C.orange }]}>-{fmt(f.feeAmount)}</Text>
                      </View>
                      <View style={styles.feeCardBody}>
                        <View style={styles.feeCardRow}>
                          <Text style={styles.feeCardLabel}>Original</Text>
                          <Text style={styles.feeCardValue}>{f.originalAmount.toFixed(4)} {f.token}</Text>
                        </View>
                        <View style={styles.feeCardRow}>
                          <Text style={styles.feeCardLabel}>Net Sent</Text>
                          <Text style={[styles.feeCardValue, { color: C.green }]}>{f.netAmount.toFixed(4)} {f.token}</Text>
                        </View>
                        <View style={styles.feeCardRow}>
                          <Text style={styles.feeCardLabel}>Fee (0.75%)</Text>
                          <Text style={[styles.feeCardValue, { color: C.orange }]}>{f.feeAmount.toFixed(6)} {f.token}</Text>
                        </View>
                        <View style={styles.feeCardRow}>
                          <Text style={styles.feeCardLabel}>From</Text>
                          <Text style={styles.feeCardAddr}>{shortAddr(f.fromWallet)}</Text>
                        </View>
                        <View style={styles.feeCardRow}>
                          <Text style={styles.feeCardLabel}>To</Text>
                          <Text style={styles.feeCardAddr}>{shortAddr(f.toWallet)}</Text>
                        </View>
                      </View>
                      <View style={styles.feeCardFooter}>
                        <Text style={styles.feeCardHash}>TX: {shortAddr(f.txHash)}</Text>
                        <Text style={styles.feeCardTime}>{timeAgo(f.timestamp)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            {tab === "revenue" && (
              <>
                {revSim ? (
                  <>
                    <View style={styles.revMetricCard}>
                      <View style={styles.revMetricHeader}>
                        <Feather name="trending-up" size={18} color={C.green} />
                        <Text style={styles.revMetricTitle}>Daily Revenue (Live)</Text>
                        <Text style={styles.revMetricWindow}>{revSim.currentMetrics.dataWindow}</Text>
                      </View>
                      <View style={styles.revMetricGrid}>
                        <View style={styles.revMetricItem}>
                          <Text style={styles.revMetricLabel}>Volume/Day</Text>
                          <Text style={[styles.revMetricValue, { color: C.primary }]}>{fmt(revSim.currentMetrics.dailyVolume)}</Text>
                        </View>
                        <View style={styles.revMetricItem}>
                          <Text style={styles.revMetricLabel}>Exec Fees/Day</Text>
                          <Text style={[styles.revMetricValue, { color: C.green }]}>{fmt(revSim.currentMetrics.dailyExecFees)}</Text>
                        </View>
                        <View style={styles.revMetricItem}>
                          <Text style={styles.revMetricLabel}>Flash Fees/Day</Text>
                          <Text style={[styles.revMetricValue, { color: C.purple }]}>{fmt(revSim.currentMetrics.dailyFlashFees)}</Text>
                        </View>
                        <View style={styles.revMetricItem}>
                          <Text style={styles.revMetricLabel}>Total/Day</Text>
                          <Text style={[styles.revMetricValue, { color: C.orange }]}>{fmt(revSim.currentMetrics.totalDailyRevenue)}</Text>
                        </View>
                      </View>
                      <View style={styles.revRateRow}>
                        <View style={styles.revRateBadge}><Text style={styles.revRateText}>Exec Fee: {revSim.currentMetrics.executionFeeRate}</Text></View>
                        <View style={styles.revRateBadge}><Text style={styles.revRateText}>Fund Fee: {revSim.currentMetrics.fundingFeeRate}</Text></View>
                        <View style={styles.revRateBadge}><Text style={styles.revRateText}>Flash: {revSim.currentMetrics.flashLoanSuccessRate} success</Text></View>
                      </View>
                    </View>

                    <Text style={styles.revSectionTitle}>Revenue Projection</Text>
                    {(["7d", "30d", "90d", "365d"] as const).map((period, idx) => {
                      const sim = revSim.simulation[period];
                      const colors = ["#3b82f6", "#22c55e", "#8b5cf6", "#f59e0b"];
                      const col = colors[idx];
                      return (
                        <View key={period} style={[styles.revPeriodCard, { borderLeftColor: col }]}>
                          <View style={styles.revPeriodHeader}>
                            <Text style={[styles.revPeriodLabel, { color: col }]}>{sim.label}</Text>
                            <Text style={styles.revPeriodGrowth}>{sim.volumeGrowth}</Text>
                          </View>
                          <View style={styles.revPeriodGrid}>
                            <View style={styles.revPeriodItem}>
                              <Text style={styles.revPeriodItemLabel}>Exec Fees</Text>
                              <Text style={[styles.revPeriodItemValue, { color: C.green }]}>{fmt(sim.executionFees)}</Text>
                            </View>
                            <View style={styles.revPeriodItem}>
                              <Text style={styles.revPeriodItemLabel}>Flash Fees</Text>
                              <Text style={[styles.revPeriodItemValue, { color: C.purple }]}>{fmt(sim.flashLoanFees)}</Text>
                            </View>
                            <View style={styles.revPeriodItem}>
                              <Text style={styles.revPeriodItemLabel}>Subscriptions</Text>
                              <Text style={[styles.revPeriodItemValue, { color: C.cyan }]}>{fmt(sim.subscriptionRevenue)}</Text>
                            </View>
                            <View style={styles.revPeriodItem}>
                              <Text style={styles.revPeriodItemLabel}>Total (USD)</Text>
                              <Text style={[styles.revPeriodItemValue, { color: col, fontSize: 16, fontWeight: "700" }]}>{fmt(sim.total)}</Text>
                            </View>
                          </View>
                          <View style={styles.revPeriodFooter}>
                            <Text style={styles.revPeriodAUD}>≈ A${sim.totalAUD.toLocaleString()}</Text>
                            <Text style={styles.revPeriodSubs}>
                              {sim.subscribers.pro} Pro · {sim.subscribers.elite} Elite · {sim.subscribers.free} Free
                            </Text>
                          </View>
                        </View>
                      );
                    })}

                    <Text style={styles.revSectionTitle}>Revenue Streams</Text>
                    {revSim.revenueStreams.map((s, i) => (
                      <View key={i} style={styles.revStreamCard}>
                        <View style={styles.revStreamHeader}>
                          <Text style={styles.revStreamName}>{s.name}</Text>
                          <Text style={[styles.revStreamPct, { color: s.pct > 50 ? C.green : s.pct > 20 ? C.primary : C.muted }]}>{s.pct}%</Text>
                        </View>
                        <View style={styles.revStreamBar}>
                          <View style={[styles.revStreamFill, { width: `${s.pct}%` as any, backgroundColor: s.pct > 50 ? C.green : s.pct > 20 ? C.primary : C.muted }]} />
                        </View>
                        <Text style={styles.revStreamDaily}>{s.note || `Daily: ${fmt(s.daily)}`}</Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <View style={styles.revLoadingCard}>
                    <Feather name="dollar-sign" size={32} color={C.muted} />
                    <Text style={styles.revLoadingText}>Loading revenue simulation…</Text>
                  </View>
                )}
              </>
            )}
          </>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      <Modal visible={!!txDetailModal} transparent animationType="slide" onRequestClose={() => setTxDetailModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Transaction Details</Text>
              <TouchableOpacity onPress={() => setTxDetailModal(null)}>
                <Feather name="x" size={22} color={C.white} />
              </TouchableOpacity>
            </View>
            {txDetailModal && (
              <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
                <View style={styles.modalSection}>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Status</Text>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <StatusDot status={txDetailModal.status} />
                      <Text style={styles.modalFieldValue}>{txDetailModal.status.toUpperCase()}</Text>
                    </View>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Type</Text>
                    <TypeBadge type={txDetailModal.type} />
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Amount</Text>
                    <Text style={styles.modalFieldValue}>{txDetailModal.amount.toFixed(6)} {txDetailModal.token}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Value (USD)</Text>
                    <Text style={styles.modalFieldValue}>{fmt(txDetailModal.amountUsd)}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Chain</Text>
                    <ChainBadge chain={txDetailModal.chain} />
                  </View>
                </View>
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Blockchain Verification</Text>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>TX Hash</Text>
                    <Text style={[styles.modalFieldValue, { fontSize: 10 }]} numberOfLines={1}>{txDetailModal.txHash}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Block #</Text>
                    <Text style={styles.modalFieldValue}>{txDetailModal.blockNumber.toLocaleString()}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>From</Text>
                    <Text style={[styles.modalFieldValue, { fontSize: 10 }]} numberOfLines={1}>{txDetailModal.from}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>To</Text>
                    <Text style={[styles.modalFieldValue, { fontSize: 10 }]} numberOfLines={1}>{txDetailModal.to}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Gas Used</Text>
                    <Text style={styles.modalFieldValue}>{txDetailModal.gasUsed.toLocaleString()}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Gas Cost</Text>
                    <Text style={styles.modalFieldValue}>{fmt(txDetailModal.gasCostUsd)}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.explorerBtn}
                    onPress={() => Linking.openURL(txDetailModal.explorerUrl)}
                    activeOpacity={0.7}
                  >
                    <Feather name="external-link" size={14} color={C.primary} />
                    <Text style={styles.explorerBtnText}>Verify on Block Explorer</Text>
                  </TouchableOpacity>
                </View>
                {txDetailModal.feeAmount ? (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>System Fee</Text>
                    <View style={styles.modalFieldRow}>
                      <Text style={styles.modalFieldLabel}>Fee Rate</Text>
                      <Text style={[styles.modalFieldValue, { color: C.orange }]}>0.75%</Text>
                    </View>
                    <View style={styles.modalFieldRow}>
                      <Text style={styles.modalFieldLabel}>Fee Amount</Text>
                      <Text style={[styles.modalFieldValue, { color: C.orange }]}>{fmt(txDetailModal.feeAmount)}</Text>
                    </View>
                    <View style={styles.modalFieldRow}>
                      <Text style={styles.modalFieldLabel}>Fee Destination</Text>
                      <Text style={[styles.modalFieldValue, { fontSize: 10 }]}>{txDetailModal.feeDestination}</Text>
                    </View>
                  </View>
                ) : null}
                {txDetailModal.agentName ? (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Agent Details</Text>
                    <View style={styles.modalFieldRow}>
                      <Text style={styles.modalFieldLabel}>Agent</Text>
                      <Text style={styles.modalFieldValue}>{txDetailModal.agentName}</Text>
                    </View>
                    <View style={styles.modalFieldRow}>
                      <Text style={styles.modalFieldLabel}>Strategy</Text>
                      <Text style={styles.modalFieldValue}>{txDetailModal.strategy}</Text>
                    </View>
                    {txDetailModal.pnl !== undefined && (
                      <View style={styles.modalFieldRow}>
                        <Text style={styles.modalFieldLabel}>P&L</Text>
                        <Text style={[styles.modalFieldValue, { color: txDetailModal.pnl >= 0 ? C.green : C.red }]}>
                          {txDetailModal.pnl >= 0 ? "+" : ""}{fmt(txDetailModal.pnl)}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null}
                <Text style={styles.modalTimestamp}>{new Date(txDetailModal.timestamp).toLocaleString()}</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!agentDetailModal} transparent animationType="slide" onRequestClose={() => setAgentDetailModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Agent Trade Details</Text>
              <TouchableOpacity onPress={() => setAgentDetailModal(null)}>
                <Feather name="x" size={22} color={C.white} />
              </TouchableOpacity>
            </View>
            {agentDetailModal && (
              <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
                <View style={styles.modalSection}>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Agent</Text>
                    <Text style={[styles.modalFieldValue, { color: C.primary }]}>{agentDetailModal.agentName}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Strategy</Text>
                    <Text style={styles.modalFieldValue}>{agentDetailModal.strategy}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Result</Text>
                    <ResultBadge result={agentDetailModal.result} />
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Pair</Text>
                    <Text style={styles.modalFieldValue}>{agentDetailModal.pair}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Action</Text>
                    <Text style={styles.modalFieldValue}>{agentDetailModal.action}</Text>
                  </View>
                </View>
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Trade Execution</Text>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Entry Price</Text>
                    <Text style={styles.modalFieldValue}>{fmt(agentDetailModal.entryPrice)}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Exit Price</Text>
                    <Text style={styles.modalFieldValue}>{fmt(agentDetailModal.exitPrice)}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Amount</Text>
                    <Text style={styles.modalFieldValue}>{agentDetailModal.amount.toFixed(4)}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>P&L</Text>
                    <Text style={[styles.modalFieldValue, { color: agentDetailModal.pnl >= 0 ? C.green : C.red, fontFamily: "Inter_700Bold" }]}>
                      {agentDetailModal.pnl >= 0 ? "+" : ""}{fmt(agentDetailModal.pnl)} ({agentDetailModal.pnlPercent}%)
                    </Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Duration</Text>
                    <Text style={styles.modalFieldValue}>{agentDetailModal.duration}</Text>
                  </View>
                </View>
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Blockchain Verification</Text>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Chain</Text>
                    <ChainBadge chain={agentDetailModal.chain} />
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>TX Hash</Text>
                    <Text style={[styles.modalFieldValue, { fontSize: 10 }]} numberOfLines={1}>{agentDetailModal.txHash}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Block #</Text>
                    <Text style={styles.modalFieldValue}>{agentDetailModal.blockNumber.toLocaleString()}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Gas Used</Text>
                    <Text style={styles.modalFieldValue}>{agentDetailModal.gasUsed.toLocaleString()}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Gas Cost</Text>
                    <Text style={styles.modalFieldValue}>{fmt(agentDetailModal.gasCostUsd)}</Text>
                  </View>
                  <View style={styles.modalFieldRow}>
                    <Text style={styles.modalFieldLabel}>Fee Deducted</Text>
                    <Text style={[styles.modalFieldValue, { color: C.orange }]}>{fmt(agentDetailModal.feeDeducted)}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.explorerBtn}
                    onPress={() => Linking.openURL(agentDetailModal.explorerUrl)}
                    activeOpacity={0.7}
                  >
                    <Feather name="external-link" size={14} color={C.primary} />
                    <Text style={styles.explorerBtnText}>Verify on Block Explorer</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalTimestamp}>{new Date(agentDetailModal.timestamp).toLocaleString()}</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  paperDisclaimer: { marginHorizontal: 16, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  paperDisclaimerText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  scrollContent: { paddingBottom: 40 },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  headerTitle: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.white, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.muted, marginTop: 4 },
  tabBar: { marginBottom: 16 },
  tabBarContent: { paddingHorizontal: 16, gap: 8 },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  tabBtnActive: { backgroundColor: `${C.primary}20`, borderColor: C.primary },
  tabBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.muted },
  tabBtnTextActive: { color: C.white },
  loadingWrap: { alignItems: "center", paddingTop: 60, gap: 12 },
  loadingText: { color: C.muted, fontFamily: "Inter_500Medium", fontSize: 14 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  summaryCard: {
    width: (SCREEN_W - 42) / 2,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  summaryIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.muted, marginBottom: 4 },
  summaryValue: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.white },
  summarySub: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted, marginTop: 3 },
  section: { paddingHorizontal: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.white, marginBottom: 12 },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  walletLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  walletChainIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  walletName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.white },
  walletAddr: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted, marginTop: 2 },
  walletBalance: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.white },
  walletChain: { fontSize: 10, fontFamily: "Inter_500Medium", color: C.muted, marginTop: 2 },
  walletTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: `${C.primary}10`,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: `${C.primary}30`,
    marginTop: 4,
  },
  walletTotalLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.dimText },
  walletTotalValue: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.primary },
  chartContainer: {
    marginHorizontal: 16,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
  },
  chartTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.white, marginBottom: 14 },
  legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  legendLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.dimText, flex: 1 },
  legendValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  agentBarRow: { marginBottom: 14 },
  agentBarHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  agentBarName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.white, flex: 1, marginRight: 8 },
  agentBarPnl: { fontSize: 14, fontFamily: "Inter_700Bold" },
  agentBarTrack: { height: 6, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" },
  agentBarFill: { height: 6, borderRadius: 3 },
  agentBarMeta: { flexDirection: "row", marginTop: 4, gap: 12 },
  agentBarMetaText: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  txLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  txDesc: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.white },
  txTime: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted, marginLeft: 8 },
  txAmount: { fontSize: 13, fontFamily: "Inter_700Bold", color: C.white },
  txAmountUsd: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.muted, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  resultBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  resultBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  chainBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, gap: 4 },
  chainBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  chainBadgeName: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  txCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  txCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  txCardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.white, flex: 1, marginLeft: 8 },
  txCardBody: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  txCardField: { width: "47%", marginBottom: 4 },
  txCardFieldLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: C.muted, marginBottom: 3 },
  txCardFieldValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.white },
  txCardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  txCardHash: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted },
  txCardTime: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted },
  txCardFee: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: `${C.orange}10`,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  txCardFeeText: { fontSize: 10, fontFamily: "Inter_500Medium", color: C.orange },
  agentCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  agentCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  agentCardName: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.white },
  agentCardStrategy: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.purple, marginTop: 2 },
  agentCardBody: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  agentCardField: { width: "47%", marginBottom: 4 },
  agentCardFieldLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: C.muted, marginBottom: 3 },
  agentCardFieldValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.white },
  agentCardFooter: { marginBottom: 8 },
  agentCardMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.dimText, marginBottom: 2 },
  feeOverviewCard: {
    marginHorizontal: 16,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: `${C.orange}30`,
    marginBottom: 20,
  },
  feeOverviewHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  feeOverviewTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.white },
  feeOverviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  feeOverviewItem: { width: "47%", marginBottom: 8 },
  feeOverviewLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.muted, marginBottom: 4 },
  feeOverviewValue: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.white },
  feeDestRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  feeDestText: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.muted },
  feeCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    borderLeftColor: C.orange,
  },
  feeCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  feeCardType: { fontSize: 11, fontFamily: "Inter_700Bold", color: C.orange, letterSpacing: 0.5 },
  feeCardToken: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted, marginTop: 2 },
  feeCardAmount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  feeCardBody: { gap: 6 },
  feeCardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  feeCardLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.muted },
  feeCardValue: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.white },
  feeCardAddr: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.dimText },
  feeCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
    marginTop: 10,
  },
  feeCardHash: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted },
  feeCardTime: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: C.elevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: "85%",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.white },
  modalSection: { marginBottom: 20 },
  modalSectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.primary, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 6 },
  modalFieldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  modalFieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.muted },
  modalFieldValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.white, maxWidth: "60%", textAlign: "right" },
  modalTimestamp: { textAlign: "center", fontSize: 11, fontFamily: "Inter_400Regular", color: C.muted, marginTop: 8, marginBottom: 16 },
  explorerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: `${C.primary}15`,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: `${C.primary}30`,
  },
  explorerBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.primary },
  revMetricCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  revMetricHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  revMetricTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.white, flex: 1 },
  revMetricWindow: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted },
  revMetricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  revMetricItem: { width: "47%", backgroundColor: C.elevated, borderRadius: 10, padding: 10 },
  revMetricLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: C.muted, marginBottom: 4 },
  revMetricValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  revRateRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  revRateBadge: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  revRateText: { fontSize: 10, fontFamily: "Inter_500Medium", color: C.dimText },
  revSectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.white, marginVertical: 12, letterSpacing: -0.3 },
  revPeriodCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
  },
  revPeriodHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  revPeriodLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  revPeriodGrowth: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.muted },
  revPeriodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  revPeriodItem: { width: "47%", backgroundColor: C.elevated, borderRadius: 8, padding: 8 },
  revPeriodItemLabel: { fontSize: 9, fontFamily: "Inter_500Medium", color: C.muted, marginBottom: 3 },
  revPeriodItemValue: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.white },
  revPeriodFooter: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  revPeriodAUD: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.green },
  revPeriodSubs: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted },
  revStreamCard: { backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  revStreamHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  revStreamName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.white, flex: 1 },
  revStreamPct: { fontSize: 15, fontFamily: "Inter_700Bold" },
  revStreamBar: { height: 4, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 2, marginBottom: 6 },
  revStreamFill: { height: 4, borderRadius: 2 },
  revStreamDaily: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.muted },
  revLoadingCard: { alignItems: "center", justifyContent: "center", padding: 48, gap: 12 },
  revLoadingText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.muted },
});
