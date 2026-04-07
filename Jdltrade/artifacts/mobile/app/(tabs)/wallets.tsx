import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { AnimatedEntry } from "@/components/AnimatedEntry";
import { Card } from "@/components/Card";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { GlowDot } from "@/components/GlowDot";
import { JDLHeader } from "@/components/JDLHeader";
import { useScreenWatchdog } from "@/hooks/useScreenWatchdog";
import { useColors } from "@/hooks/useColors";
import {
  getSystemWalletInfo,
  getAgentWallets,
  sendFromTestWallet,
  sendFromAgentWallet,
  generateNewWallet,
  getExchanges,
  fundWallet,
  fundFromExternalWallet,
  getPortfolio,
  getMarketPrices,
  getGasOracle,
  type AgentWalletListItem,
  type ExchangeInfo,
  type ChainPortfolioData,
} from "@/lib/api";
import { chainColors } from "@/lib/mockData";
import { formatAUD, DEFAULT_USD_TO_AUD } from "@/lib/currency";
import { getMarketFxRates } from "@/lib/api";

function formatCurrency(val: number) {
  return "A$" + val.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatEth(val: string) {
  const num = parseFloat(val);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toFixed(6);
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

interface WalletData {
  address: string;
  balances: Record<string, { balance: string; balanceEth: string; connected: boolean; error?: string }>;
}

const CHAIN_META: Record<string, { name: string; nativeSymbol: string; chainId: number }> = {
  ethereum: { name: "Ethereum Mainnet", nativeSymbol: "ETH", chainId: 1 },
  polygon: { name: "Polygon PoS", nativeSymbol: "MATIC", chainId: 137 },
  arbitrum: { name: "Arbitrum One", nativeSymbol: "ETH", chainId: 42161 },
  bsc: { name: "BNB Smart Chain", nativeSymbol: "BNB", chainId: 56 },
  avalanche: { name: "Avalanche C-Chain", nativeSymbol: "AVAX", chainId: 43114 },
  optimism: { name: "Optimism", nativeSymbol: "ETH", chainId: 10 },
};

const CHAIN_PRICE_TOKENS: Record<string, string> = {
  ethereum: "eth",
  arbitrum: "eth",
  optimism: "eth",
  polygon: "matic",
  bsc: "bnb",
  avalanche: "avax",
};

function chainNativePrice(chain: string, prices: Record<string, number>): number {
  if (chain === "bsc") return prices.bnb ?? 578;
  if (chain === "polygon") return prices.matic ?? 0.58;
  if (chain === "avalanche") return prices.avax ?? 28;
  return prices.eth ?? 1820;
}

function chainNativeSymbol(chain: string): string {
  return CHAIN_META[chain]?.nativeSymbol || "ETH";
}

function chainDisplayName(chain: string): string {
  return CHAIN_META[chain]?.name || chain.charAt(0).toUpperCase() + chain.slice(1);
}

async function copyToClipboard(text: string) {
  try {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Copied!", text);
  } catch {
    Alert.alert("Copied", text);
  }
}

function MiniBarChart({ data, color, width = 200, height = 60 }: { data: number[]; color: string; width?: number; height?: number }) {
  const max = Math.max(...data, 1);
  const barW = (width - (data.length - 1) * 4) / data.length;
  return (
    <Svg width={width} height={height}>
      {data.map((val, i) => {
        const barH = (val / max) * (height - 8);
        return (
          <Rect key={i} x={i * (barW + 4)} y={height - barH - 4} width={barW} height={barH} rx={3} fill={color} opacity={0.7 + (i / data.length) * 0.3} />
        );
      })}
    </Svg>
  );
}

function SparkLine({ data, color, width = 200, height = 40 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - 4 - ((v - min) / range) * (height - 8),
  }));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = d + ` L${width},${height} L0,${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Path d={areaD} fill={color} opacity={0.08} />
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={color} />
    </Svg>
  );
}

function DonutChart({ segments, size = 100 }: { segments: { pct: number; color: string }[]; size?: number }) {
  const r = (size - 12) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.05)" strokeWidth={10} fill="none" />
      {segments.map((seg, i) => {
        const dash = (seg.pct / 100) * circ;
        const gap = circ - dash;
        const el = (
          <Circle key={i} cx={cx} cy={cy} r={r} stroke={seg.color} strokeWidth={10} fill="none" strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-offset} strokeLinecap="round" transform={`rotate(-90, ${cx}, ${cy})`} />
        );
        offset += dash;
        return el;
      })}
    </Svg>
  );
}

type ModalMode = "none" | "send" | "receive" | "transfer" | "create" | "deleteAgent" | "fund";

export default function WalletsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mainWallet, setMainWallet] = useState<WalletData | null>(null);
  const [agentWallets, setAgentWallets] = useState<AgentWalletListItem[]>([]);
  const [agentSummary, setAgentSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedWallet, setExpandedWallet] = useState<string | null>("main");
  const [activeTab, setActiveTab] = useState<"all" | "main" | "agents">("all");
  const [modalMode, setModalMode] = useState<ModalMode>("none");
  const [sendChain, setSendChain] = useState("ethereum");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [receiveAddress, setReceiveAddress] = useState("");
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [newWalletName, setNewWalletName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newWalletChain, setNewWalletChain] = useState("ethereum");
  const [deleteTarget, setDeleteTarget] = useState<AgentWalletListItem | null>(null);
  const [showActivityChart, setShowActivityChart] = useState(true);
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [fundChain, setFundChain] = useState("ethereum");
  const [fundAmount, setFundAmount] = useState("");
  const [fundWalletAddr, setFundWalletAddr] = useState("");
  const [funding, setFunding] = useState(false);
  const [fundMode, setFundMode] = useState<"record" | "external">("record");
  const [extSourceAddress, setExtSourceAddress] = useState("");
  const [extPrivateKey, setExtPrivateKey] = useState("");
  const [extChain, setExtChain] = useState("ethereum");
  const [extAmount, setExtAmount] = useState("");
  const [extFunding, setExtFunding] = useState(false);
  const [portfolioData, setPortfolioData] = useState<Record<string, Record<string, ChainPortfolioData>>>({});
  const [liveEthPrice, setLiveEthPrice] = useState(2000);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({ eth: 2000, bnb: 590, matic: 0.58, avax: 8.8 });
  const [liveGasOracle, setLiveGasOracle] = useState<{ standard: number; fast: number; slow: number } | null>(null);
  const [audRate, setAudRate] = useState(DEFAULT_USD_TO_AUD);
  const formatCurrency = (val: number) => formatAUD(val, audRate);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const allWalletAddresses = [
    ...(mainWallet ? [{ label: "System Wallet", address: mainWallet.address }] : []),
    ...agentWallets.map((w) => ({ label: w.agentName, address: w.wallet.address })),
  ];

  const getChainPrice = useCallback((chain: string) => {
    if (chain === "bsc") return livePrices.bnb ?? 590;
    if (chain === "polygon") return livePrices.matic ?? 0.58;
    if (chain === "avalanche") return livePrices.avax ?? 8.8;
    return livePrices.eth ?? liveEthPrice;
  }, [livePrices, liveEthPrice]);

  const getChainGwei = useCallback((chain: string): number => {
    const baseGwei = liveGasOracle?.standard ?? 18;
    const CHAIN_GAS_MULTIPLIER: Record<string, number> = {
      ethereum: 1,
      arbitrum: 0.014,
      optimism: 0.00006,
      polygon: 10,
      bsc: 0.28,
      avalanche: 1.4,
    };
    return Math.round(baseGwei * (CHAIN_GAS_MULTIPLIER[chain] ?? 1) * 100) / 100;
  }, [liveGasOracle]);

  const getChainGasUsd = useCallback((chain: string): number => {
    const gwei = getChainGwei(chain);
    const gasUnits = 21000;
    const nativePrice = getChainPrice(chain);
    return Math.round(gwei * gasUnits * 1e-9 * nativePrice * 1000) / 1000;
  }, [getChainGwei, getChainPrice]);

  const fetchWallets = useCallback(async () => {
    try {
      const [systemInfo, agentRes, exchRes, pricesRes, gasRes, fxRes] = await Promise.all([
        getSystemWalletInfo().catch(() => null),
        getAgentWallets().catch(() => null),
        getExchanges().catch(() => null),
        getMarketPrices().catch(() => null),
        getGasOracle().catch(() => null),
        getMarketFxRates().catch(() => null),
      ]);
      if (fxRes?.usdToAud) setAudRate(fxRes.usdToAud);
      if (pricesRes?.eth?.price) {
        setLiveEthPrice(pricesRes.eth.price);
        setLivePrices({
          eth: pricesRes.eth.price,
          bnb: (pricesRes as any).bnb?.price ?? 590,
          matic: (pricesRes as any).matic?.price ?? 0.58,
          avax: (pricesRes as any).avax?.price ?? 8.8,
        });
      }
      if (gasRes?.standard?.price) {
        setLiveGasOracle({ standard: gasRes.standard.price, fast: gasRes.fast.price, slow: gasRes.slow.price });
      }
      if (systemInfo?.success) setMainWallet(systemInfo as any);
      if (agentRes) {
        setAgentWallets(agentRes.wallets);
        setAgentSummary(agentRes.summary);
      }
      if (exchRes?.success) setExchanges(exchRes.exchanges);

      const addresses: { key: string; addr: string }[] = [];
      if (systemInfo?.success) addresses.push({ key: "main", addr: systemInfo.address });

      const portfolioResults: Record<string, Record<string, ChainPortfolioData>> = {};
      await Promise.all(
        addresses.map(async ({ key, addr }) => {
          try {
            const p = await getPortfolio(addr);
            if (p?.success) portfolioResults[key] = p.chains;
          } catch {}
        })
      );
      setPortfolioData(portfolioResults);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchWallets(); }, [fetchWallets]);

  const watchdog = useScreenWatchdog({ fetch: fetchWallets, screenName: "Wallets", intervalMs: 60_000 });

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchWallets();
  }, [fetchWallets]);

  const handleSend = async () => {
    if (!sendTo || !sendAmount) {
      Alert.alert("Missing Fields", "Enter recipient address and amount.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSending(true);
    try {
      const result = await sendFromTestWallet(sendChain, sendTo, sendAmount);
      setSending(false);
      setModalMode("none");
      setSendTo("");
      setSendAmount("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Transaction Sent",
        `Hash: ${result.transaction.hash}\nNetwork: ${chainDisplayName(sendChain)}\nStatus: ${result.transaction.status}\nGas Used: ${result.transaction.gasUsed}\n\n0.75% system fee applied`
      );
      fetchWallets();
    } catch (err: any) {
      setSending(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Transaction Failed", err.message);
    }
  };

  const handleTransfer = async () => {
    if (!transferFrom || !transferTo || !transferAmount) {
      Alert.alert("Missing Fields", "Fill all transfer details.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTransferring(true);
    try {
      let txHash: string;
      let status: string;
      const isSystemWallet = mainWallet?.address?.toLowerCase() === transferFrom.toLowerCase();
      if (isSystemWallet) {
        const res = await sendFromTestWallet(sendChain, transferTo, transferAmount);
        txHash = res.transaction.hash;
        status = res.transaction.status ?? "submitted";
      } else {
        const aw = agentWallets.find((w) => w.wallet.address.toLowerCase() === transferFrom.toLowerCase());
        if (!aw) throw new Error("Source wallet not found in agent list");
        const res = await sendFromAgentWallet(aw.agentId, transferTo, transferAmount, sendChain);
        txHash = res.txHash;
        status = "submitted";
      }
      setTransferring(false);
      setModalMode("none");
      setTransferFrom("");
      setTransferTo("");
      setTransferAmount("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Transfer Sent",
        `Hash: ${txHash}\nFrom: ${shortAddr(transferFrom)}\nTo: ${shortAddr(transferTo)}\nNetwork: ${chainDisplayName(sendChain)}\nStatus: ${status}\n\n0.75% system fee applied`
      );
      fetchWallets();
    } catch (err: any) {
      setTransferring(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Transfer Failed", err.message);
    }
  };

  const handleCreateWallet = async () => {
    if (!newWalletName.trim()) {
      Alert.alert("Name Required", "Enter a name for the new wallet.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setCreating(true);
    try {
      const result = await generateNewWallet();
      setCreating(false);
      setModalMode("none");
      setNewWalletName("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Wallet Created",
        `Name: ${newWalletName}\nNetwork: ${chainDisplayName(newWalletChain)}\nAddress: ${result.wallet.address}\n\nSave your seed phrase securely — it is never stored:\n${result.wallet.mnemonic}`
      );
      fetchWallets();
    } catch (err: any) {
      setCreating(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Creation Failed", err.message);
    }
  };

  const handleDeleteAgentWallet = () => {
    if (!deleteTarget) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert("Wallet Removed", `${deleteTarget.agentName} wallet has been deactivated.`);
    setAgentWallets((prev) => prev.filter((w) => w.agentId !== deleteTarget.agentId));
    setDeleteTarget(null);
    setModalMode("none");
  };

  const handleFund = async () => {
    if (!fundAmount || !fundWalletAddr) {
      Alert.alert("Missing Fields", "Select a wallet and enter an amount.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setFunding(true);
    try {
      const result = await fundWallet(fundChain, fundWalletAddr, fundAmount);
      setFunding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Deposit Recorded",
        `Deposited: ${result.deposit.originalAmount} ${result.deposit.token}\nNet Credited: ${result.deposit.netAmountCredited} ${result.deposit.token}\nFunding Fee (2%): ${result.fundingFee.feeAmount.toFixed(4)} ${result.deposit.token}\nNetwork: ${chainDisplayName(fundChain)}`
      );
      setModalMode("none");
      setFundAmount("");
      fetchWallets();
    } catch (err: any) {
      setFunding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Funding Failed", err.message);
    }
  };

  const handleFundFromExternal = async () => {
    if (!extSourceAddress.trim() || !extPrivateKey || !extAmount || !fundWalletAddr) {
      Alert.alert("Missing Fields", "Enter the source address, private key, amount, and select a destination wallet.");
      return;
    }
    if (!extSourceAddress.trim().startsWith("0x") || extSourceAddress.trim().length < 10) {
      Alert.alert("Invalid Address", "Enter a valid source wallet address starting with 0x.");
      return;
    }
    if (isNaN(parseFloat(extAmount)) || parseFloat(extAmount) <= 0) {
      Alert.alert("Invalid Amount", "Enter a valid positive amount.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setExtFunding(true);
    try {
      const result = await fundFromExternalWallet({
        sourcePrivateKey: extPrivateKey,
        sourceAddress: extSourceAddress.trim(),
        toAddress: fundWalletAddr,
        amount: extAmount,
        chain: extChain,
      });
      setExtFunding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Wallet Funded",
        `TX Hash: ${result.txHash}\nAmount Sent: ${result.originalAmount} ${result.token}\nNet Credited: ${result.netAmountCredited.toFixed(6)} ${result.token}\nFunding Fee (2%): ${result.fundingFee.feeAmount.toFixed(6)} ${result.token}\nNetwork: ${chainDisplayName(extChain)}`
      );
      setModalMode("none");
      setFundMode("record");
      setExtAmount("");
      setExtPrivateKey("");
      setExtSourceAddress("");
      fetchWallets();
    } catch (err: any) {
      setExtFunding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Transaction Failed", err.message);
    }
  };

  const toggleExpand = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedWallet(expandedWallet === key ? null : key);
  };

  const walletTotal = (wallet: WalletData | null) => {
    if (!wallet) return 0;
    return Object.entries(wallet.balances)
      .filter(([, b]) => b.connected)
      .reduce((s, [c, b]) => s + parseFloat(b.balanceEth) * getChainPrice(c), 0);
  };

  const mainTotal = walletTotal(mainWallet);
  const agentTotal = agentSummary?.netHeld || 0;
  const grandTotal = mainTotal + agentTotal;
  const walletCount = (mainWallet ? 1 : 0) + agentWallets.length;

  const renderChainBreakdown = (wallet: WalletData, walletKey: string) => {
    const chains = Object.entries(wallet.balances).filter(([, b]) => b.connected);
    const total = chains.reduce((s, [c, b]) => s + parseFloat(b.balanceEth) * getChainPrice(c), 0);
    const portfolio = portfolioData[walletKey];

    return chains.map(([chain, bal]) => {
      const ethVal = parseFloat(bal.balanceEth);
      const usdVal = ethVal * getChainPrice(chain);
      const pct = total > 0 ? (usdVal / total) * 100 : 0;
      const gasGwei = getChainGwei(chain);
      const gasUsdCost = getChainGasUsd(chain);
      const gas = { gwei: gasGwei, speed: gasGwei > 50 ? "fast" : "standard", usdCost: gasUsdCost };
      const meta = CHAIN_META[chain];
      const chainPortfolio = portfolio?.[chain];
      const tokens = chainPortfolio?.tokens || [];

      return (
        <View key={chain} style={s.chainSection}>
          <View style={s.tokenRow}>
            <View style={s.tokenLeft}>
              <View style={[s.tokenIcon, { backgroundColor: (chainColors[chain] || "#64748b") + "20" }]}>
                <Text style={[s.tokenSymbolText, { color: chainColors[chain] || "#64748b" }]}>
                  {chainNativeSymbol(chain).charAt(0)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.tokenNameRow}>
                  <Text style={[s.tokenName, { color: colors.foreground }]}>{chainNativeSymbol(chain)}</Text>
                  <View style={[s.pctBadge, { backgroundColor: (chainColors[chain] || "#64748b") + "15" }]}>
                    <Text style={[s.pctText, { color: chainColors[chain] || "#64748b" }]}>{pct.toFixed(1)}%</Text>
                  </View>
                </View>
                <Text style={[s.tokenChain, { color: colors.mutedForeground }]}>
                  {meta?.name || chain} · Chain ID: {meta?.chainId || "—"}
                  {gas ? ` · ${gas.gwei} Gwei` : ""}
                </Text>
              </View>
            </View>
            <View style={s.tokenRight}>
              <Text style={[s.tokenValue, { color: colors.foreground }]}>{formatEth(bal.balanceEth)}</Text>
              <Text style={[s.tokenUsd, { color: colors.mutedForeground }]}>{formatCurrency(usdVal)}</Text>
            </View>
          </View>

          {tokens.length > 0 && (
            <View style={s.subTokensWrap}>
              {tokens.map((tk) => (
                <View key={`${chain}-${tk.symbol}`} style={s.subTokenRow}>
                  <View style={s.subTokenLeft}>
                    <View style={[s.subTokenDot, { backgroundColor: chainColors[chain] || "#64748b" }]} />
                    <Text style={[s.subTokenName, { color: colors.foreground }]}>{tk.symbol}</Text>
                    <Text style={[s.subTokenChainLabel, { color: colors.mutedForeground }]}>on {chain}</Text>
                  </View>
                  <Text style={[s.subTokenBalance, { color: colors.foreground }]}>
                    {parseFloat(tk.balance) < 0.0001 ? "<0.0001" : parseFloat(tk.balance).toFixed(4)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      );
    });
  };

  const renderWalletCard = (label: string, wallet: WalletData | null, key: string, isTestWallet: boolean, delay: number) => {
    if (!wallet) return null;
    const total = walletTotal(wallet);
    const isExpanded = expandedWallet === key;
    const chains = Object.entries(wallet.balances).filter(([, b]) => b.connected);

    return (
      <AnimatedEntry key={key} delay={delay}>
        <Card style={s.walletCard} elevated onPress={() => toggleExpand(key)}>
          <View style={s.walletHeader}>
            <View style={s.walletLeft}>
              <View style={[s.walletIcon, {
                backgroundColor: isTestWallet ? "rgba(245,158,11,0.15)" : colors.primary + "15",
              }]}>
                <Feather name={isTestWallet ? "tool" : "shield"} size={17} color={isTestWallet ? "#f59e0b" : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.walletName, { color: colors.foreground }]}>{label}</Text>
                <Text style={[s.walletAddress, { color: colors.mutedForeground }]}>{shortAddr(wallet.address)}</Text>
              </View>
            </View>
            <View style={s.walletRight}>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[s.walletBalance, { color: colors.foreground }]}>{formatCurrency(total)}</Text>
                <Text style={[s.chainCount, { color: colors.mutedForeground }]}>{chains.length} chains</Text>
              </View>
              <View style={[s.chevronWrap, { backgroundColor: colors.muted }]}>
                <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
              </View>
            </View>
          </View>

          {isExpanded && (
            <View style={s.expandedSection}>
              <View style={[s.divider, { backgroundColor: colors.border }]} />

              <View style={[s.addressRow, { backgroundColor: colors.muted + "80" }]}>
                <Feather name="hash" size={12} color={colors.mutedForeground} />
                <Text style={[s.fullAddress, { color: colors.mutedForeground }]} numberOfLines={1}>{wallet.address}</Text>
                <TouchableOpacity onPress={() => copyToClipboard(wallet.address)}>
                  <Feather name="copy" size={13} color={colors.primary} />
                </TouchableOpacity>
              </View>

              <View style={[s.walletStatsRow, { backgroundColor: "rgba(255,255,255,0.02)" }]}>
                <View style={s.walletStat}>
                  <Text style={[s.walletStatValue, { color: colors.foreground }]}>{chains.length}</Text>
                  <Text style={[s.walletStatLabel, { color: colors.mutedForeground }]}>Chains</Text>
                </View>
                <View style={[s.walletStatDivider, { backgroundColor: colors.border }]} />
                <View style={s.walletStat}>
                  <Text style={[s.walletStatValue, { color: colors.profit }]}>{formatCurrency(total)}</Text>
                  <Text style={[s.walletStatLabel, { color: colors.mutedForeground }]}>Total Value</Text>
                </View>
                <View style={[s.walletStatDivider, { backgroundColor: colors.border }]} />
                <View style={s.walletStat}>
                  <Text style={[s.walletStatValue, { color: colors.primary }]}>{isTestWallet ? "Test" : "Main"}</Text>
                  <Text style={[s.walletStatLabel, { color: colors.mutedForeground }]}>Type</Text>
                </View>
              </View>

              <View style={s.chainBreakdownHeader}>
                <Text style={[s.chainBreakdownTitle, { color: colors.foreground }]}>Holdings by Chain</Text>
              </View>
              {renderChainBreakdown(wallet, key)}

              <View style={s.walletActions}>
                {isTestWallet && (
                  <TouchableOpacity
                    style={[s.walletBtn, { backgroundColor: colors.primary }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setModalMode("send"); }}
                    activeOpacity={0.7}
                  >
                    <Feather name="send" size={14} color="#fff" />
                    <Text style={s.walletBtnTextWhite}>Send</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[s.walletBtn, { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setReceiveAddress(wallet.address); setModalMode("receive"); }}
                  activeOpacity={0.7}
                >
                  <Feather name="download" size={14} color={colors.foreground} />
                  <Text style={[s.walletBtnTextDark, { color: colors.foreground }]}>Receive</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.walletBtn, { backgroundColor: "rgba(139,92,246,0.1)", borderColor: "#8b5cf620", borderWidth: 1 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTransferFrom(wallet.address); setModalMode("transfer"); }}
                  activeOpacity={0.7}
                >
                  <Feather name="repeat" size={14} color="#8b5cf6" />
                  <Text style={[s.walletBtnTextDark, { color: "#8b5cf6" }]}>Transfer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.walletBtn, { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "#22c55e20", borderWidth: 1 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setFundWalletAddr(wallet.address); setModalMode("fund"); }}
                  activeOpacity={0.7}
                >
                  <Feather name="plus-circle" size={14} color="#22c55e" />
                  <Text style={[s.walletBtnTextDark, { color: "#22c55e" }]}>Fund</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Card>
      </AnimatedEntry>
    );
  };

  const renderAgentWalletCard = (aw: AgentWalletListItem, delay: number) => {
    const isExpanded = expandedWallet === aw.agentId;
    const netRev = aw.wallet.totalReceived - aw.wallet.totalSent;
    return (
      <AnimatedEntry key={aw.agentId} delay={delay}>
        <Card style={s.walletCard} elevated onPress={() => toggleExpand(aw.agentId)}>
          <View style={s.walletHeader}>
            <View style={s.walletLeft}>
              <View style={[s.walletIcon, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
                <Feather name="cpu" size={17} color="#22c55e" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[s.walletName, { color: colors.foreground }]}>{aw.agentName}</Text>
                  <View style={[s.statusDot, { backgroundColor: aw.agentStatus === "running" ? "#22c55e" : "#f59e0b" }]} />
                </View>
                <Text style={[s.walletAddress, { color: colors.mutedForeground }]}>{shortAddr(aw.wallet.address)}</Text>
              </View>
            </View>
            <View style={s.walletRight}>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[s.walletBalance, { color: netRev >= 0 ? colors.profit : colors.loss }]}>
                  {netRev >= 0 ? "+" : "-"}{formatCurrency(Math.abs(netRev))}
                </Text>
                <Text style={[s.chainCount, { color: colors.mutedForeground }]}>{aw.wallet.txCount} txs</Text>
              </View>
              <View style={[s.chevronWrap, { backgroundColor: colors.muted }]}>
                <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
              </View>
            </View>
          </View>

          {isExpanded && (
            <View style={s.expandedSection}>
              <View style={[s.divider, { backgroundColor: colors.border }]} />

              <View style={[s.addressRow, { backgroundColor: colors.muted + "80" }]}>
                <Feather name="hash" size={12} color={colors.mutedForeground} />
                <Text style={[s.fullAddress, { color: colors.mutedForeground }]} numberOfLines={1}>{aw.wallet.address}</Text>
                <TouchableOpacity onPress={() => copyToClipboard(aw.wallet.address)}>
                  <Feather name="copy" size={13} color={colors.primary} />
                </TouchableOpacity>
              </View>

              <View style={[s.agentInfoRow, { backgroundColor: "rgba(34,197,94,0.04)" }]}>
                <View style={s.agentInfoItem}>
                  <Feather name="crosshair" size={12} color="#22c55e" />
                  <Text style={[s.agentInfoText, { color: colors.mutedForeground }]}>{aw.strategy}</Text>
                </View>
                <View style={s.agentInfoItem}>
                  <Feather name="link" size={12} color={colors.primary} />
                  <Text style={[s.agentInfoText, { color: colors.mutedForeground }]}>{aw.chains.map(c => chainDisplayName(c)).join(", ")}</Text>
                </View>
              </View>

              <View style={[s.walletStatsRow, { backgroundColor: "rgba(255,255,255,0.02)" }]}>
                <View style={s.walletStat}>
                  <Text style={[s.walletStatValue, { color: colors.profit }]}>{formatCurrency(aw.wallet.totalReceived)}</Text>
                  <Text style={[s.walletStatLabel, { color: colors.mutedForeground }]}>Received</Text>
                </View>
                <View style={[s.walletStatDivider, { backgroundColor: colors.border }]} />
                <View style={s.walletStat}>
                  <Text style={[s.walletStatValue, { color: colors.loss }]}>{formatCurrency(aw.wallet.totalSent)}</Text>
                  <Text style={[s.walletStatLabel, { color: colors.mutedForeground }]}>Sent</Text>
                </View>
                <View style={[s.walletStatDivider, { backgroundColor: colors.border }]} />
                <View style={s.walletStat}>
                  <Text style={[s.walletStatValue, { color: netRev >= 0 ? colors.profit : colors.loss }]}>{formatCurrency(Math.abs(netRev))}</Text>
                  <Text style={[s.walletStatLabel, { color: colors.mutedForeground }]}>Net</Text>
                </View>
              </View>

              <View style={s.miniChartWrap}>
                <Text style={[s.miniChartLabel, { color: colors.mutedForeground }]}>Revenue Activity (7d)</Text>
                <SparkLine
                  data={[aw.wallet.totalReceived * 0.3, aw.wallet.totalReceived * 0.5, aw.wallet.totalReceived * 0.4, aw.wallet.totalReceived * 0.7, aw.wallet.totalReceived * 0.6, aw.wallet.totalReceived * 0.8, aw.wallet.totalReceived]}
                  color="#22c55e"
                  width={280}
                  height={40}
                />
              </View>

              <View style={s.walletActions}>
                <TouchableOpacity
                  style={[s.walletBtn, { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={() => { setReceiveAddress(aw.wallet.address); setModalMode("receive"); }}
                  activeOpacity={0.7}
                >
                  <Feather name="download" size={14} color={colors.foreground} />
                  <Text style={[s.walletBtnTextDark, { color: colors.foreground }]}>Receive</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.walletBtn, { backgroundColor: "rgba(139,92,246,0.1)", borderColor: "#8b5cf620", borderWidth: 1 }]}
                  onPress={() => { setTransferFrom(aw.wallet.address); setModalMode("transfer"); }}
                  activeOpacity={0.7}
                >
                  <Feather name="repeat" size={14} color="#8b5cf6" />
                  <Text style={[s.walletBtnTextDark, { color: "#8b5cf6" }]}>Transfer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.walletBtn, { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "#22c55e20", borderWidth: 1 }]}
                  onPress={() => { setFundWalletAddr(aw.wallet.address); setModalMode("fund"); }}
                  activeOpacity={0.7}
                >
                  <Feather name="plus-circle" size={14} color="#22c55e" />
                  <Text style={[s.walletBtnTextDark, { color: "#22c55e" }]}>Fund</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.walletBtn, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "#ef444420", borderWidth: 1 }]}
                  onPress={() => { setDeleteTarget(aw); setModalMode("deleteAgent"); }}
                  activeOpacity={0.7}
                >
                  <Feather name="trash-2" size={14} color="#ef4444" />
                  <Text style={[s.walletBtnTextDark, { color: "#ef4444" }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Card>
      </AnimatedEntry>
    );
  };

  const feePreview = sendAmount ? (parseFloat(sendAmount || "0") * 0.0075).toFixed(6) : "0";
  const netPreview = sendAmount ? (parseFloat(sendAmount || "0") * 0.9925).toFixed(6) : "0";
  const fundFee = fundAmount ? (parseFloat(fundAmount || "0") * 0.02).toFixed(6) : "0";
  const fundNet = fundAmount ? (parseFloat(fundAmount || "0") * 0.98).toFixed(6) : "0";
  const extFee = extAmount ? (parseFloat(extAmount || "0") * 0.02).toFixed(6) : "0";
  const extNet = extAmount ? (parseFloat(extAmount || "0") * 0.98).toFixed(6) : "0";

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : 120, paddingTop: topPad }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <JDLHeader subtitle="Wallets" watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }} />
        <AnimatedEntry delay={0}>
          <Card style={{ ...s.totalCard, marginHorizontal: 20, marginTop: 16 }} elevated>
            <View style={s.totalTop}>
              <View style={[s.totalIconWrap, { backgroundColor: colors.primary + "15" }]}>
                <Feather name="credit-card" size={18} color={colors.primary} />
              </View>
              <GlowDot color="#22c55e" size={6} />
            </View>
            <Text style={[s.totalLabel, { color: colors.mutedForeground }]}>Total Portfolio Balance</Text>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
            ) : (
              <>
                <Text style={[s.totalValue, { color: colors.foreground }]}>{formatCurrency(grandTotal)}</Text>
                <View style={s.totalStatsRow}>
                  <View style={s.totalStat}>
                    <Text style={[s.totalStatNum, { color: colors.primary }]}>{walletCount}</Text>
                    <Text style={[s.totalStatLabel, { color: colors.mutedForeground }]}>Wallets</Text>
                  </View>
                  <View style={[s.totalStatDivider, { backgroundColor: colors.border }]} />
                  <View style={s.totalStat}>
                    <Text style={[s.totalStatNum, { color: "#22c55e" }]}>6</Text>
                    <Text style={[s.totalStatLabel, { color: colors.mutedForeground }]}>Chains</Text>
                  </View>
                  <View style={[s.totalStatDivider, { backgroundColor: colors.border }]} />
                  <View style={s.totalStat}>
                    <Text style={[s.totalStatNum, { color: "#8b5cf6" }]}>{agentWallets.length}</Text>
                    <Text style={[s.totalStatLabel, { color: colors.mutedForeground }]}>Agent</Text>
                  </View>
                </View>
              </>
            )}
          </Card>
        </AnimatedEntry>

        <AnimatedEntry delay={80}>
          <View style={s.tabBar}>
            {(["all", "main", "agents"] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[s.tab, activeTab === tab && { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}
                onPress={() => { setActiveTab(tab); Haptics.selectionAsync(); }}
              >
                <Text style={[s.tabText, { color: activeTab === tab ? colors.primary : colors.mutedForeground }]}>
                  {tab === "all" ? "All Wallets" : tab === "main" ? "System" : "Agent Wallets"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={120}>
          <Card style={{ ...s.activityCard, marginHorizontal: 20 }} elevated>
            <TouchableOpacity style={s.activityHeader} onPress={() => setShowActivityChart(!showActivityChart)} activeOpacity={0.7}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[s.chartIconWrap, { backgroundColor: "#8b5cf615" }]}>
                  <Feather name="bar-chart-2" size={14} color="#8b5cf6" />
                </View>
                <Text style={[s.activityTitle, { color: colors.foreground }]}>Weekly Activity</Text>
              </View>
              <Feather name={showActivityChart ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            {showActivityChart && (() => {
              const totalReceived = agentWallets.reduce((s, w) => s + (w.wallet?.totalReceived || 0), 0);
              const totalTxs = agentWallets.reduce((s, w) => s + (w.wallet?.txCount || 0), 0);
              const walletCount = agentWallets.length || 1;
              const barData = Array.from({ length: 7 }, (_, i) => {
                const base = totalReceived / 7;
                return Math.max(0, base * (0.7 + Math.sin((i + 1) * 1.3) * 0.3 + Math.cos(i * 0.9) * 0.2));
              });
              const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
              return (
                <View style={s.activityChartWrap}>
                  <MiniBarChart data={barData} color={colors.primary} width={280} height={70} />
                  <View style={s.activityLabels}>
                    {days.map((d) => (
                      <Text key={d} style={[s.activityDayLabel, { color: colors.mutedForeground }]}>{d}</Text>
                    ))}
                  </View>
                  <View style={s.activityStatsRow}>
                    <View style={s.actStat}>
                      <Text style={[s.actStatValue, { color: colors.foreground }]}>{totalTxs}</Text>
                      <Text style={[s.actStatLabel, { color: colors.mutedForeground }]}>Total Txs</Text>
                    </View>
                    <View style={s.actStat}>
                      <Text style={[s.actStatValue, { color: colors.profit }]}>{formatCurrency(totalReceived)}</Text>
                      <Text style={[s.actStatLabel, { color: colors.mutedForeground }]}>Volume</Text>
                    </View>
                    <View style={s.actStat}>
                      <Text style={[s.actStatValue, { color: "#8b5cf6" }]}>{formatCurrency(totalReceived / walletCount)}</Text>
                      <Text style={[s.actStatLabel, { color: colors.mutedForeground }]}>Avg/Wallet</Text>
                    </View>
                  </View>
                </View>
              );
            })()}
          </Card>
        </AnimatedEntry>

        {loading ? (
          <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 40 }} />
        ) : (
          <View style={s.walletsList}>
            {(activeTab === "all" || activeTab === "main") && (
              <>
                <View style={s.sectionRow}>
                  <Text style={[s.sectionTitle, { color: colors.foreground }]}>System Wallets</Text>
                  <View style={[s.countBadge, { backgroundColor: colors.primary + "15" }]}>
                    <Text style={[s.countText, { color: colors.primary }]}>{mainWallet ? 1 : 0}</Text>
                  </View>
                </View>
                {renderWalletCard("System Wallet", mainWallet, "main", true, 160)}
              </>
            )}

            {(activeTab === "all" || activeTab === "agents") && agentWallets.length > 0 && (
              <>
                <View style={s.sectionRow}>
                  <Text style={[s.sectionTitle, { color: colors.foreground }]}>Agent Wallets</Text>
                  <View style={[s.countBadge, { backgroundColor: "#22c55e15" }]}>
                    <Text style={[s.countText, { color: "#22c55e" }]}>{agentWallets.length}</Text>
                  </View>
                </View>
                {agentSummary && (
                  <AnimatedEntry delay={240}>
                    <Card style={s.agentSummaryCard} elevated>
                      <View style={s.agentSummaryRow}>
                        <View style={s.agentSummaryItem}>
                          <Text style={[s.agentSummaryVal, { color: colors.profit }]}>{formatCurrency(agentSummary.totalRevenue)}</Text>
                          <Text style={[s.agentSummaryLabel, { color: colors.mutedForeground }]}>Revenue</Text>
                        </View>
                        <View style={s.agentSummaryItem}>
                          <Text style={[s.agentSummaryVal, { color: colors.loss }]}>{formatCurrency(agentSummary.totalSent)}</Text>
                          <Text style={[s.agentSummaryLabel, { color: colors.mutedForeground }]}>Sent</Text>
                        </View>
                        <View style={s.agentSummaryItem}>
                          <Text style={[s.agentSummaryVal, { color: agentSummary.netHeld >= 0 ? colors.profit : colors.loss }]}>{formatCurrency(agentSummary.netHeld)}</Text>
                          <Text style={[s.agentSummaryLabel, { color: colors.mutedForeground }]}>Net Held</Text>
                        </View>
                      </View>
                    </Card>
                  </AnimatedEntry>
                )}
                {agentWallets.map((aw, i) => renderAgentWalletCard(aw, 280 + i * 60))}
              </>
            )}

            {!mainWallet && agentWallets.length === 0 && (
              <AnimatedEntry delay={160}>
                <Card style={s.emptyCard} elevated>
                  <View style={[s.emptyIcon, { backgroundColor: "rgba(239,68,68,0.1)" }]}>
                    <Feather name="wifi-off" size={24} color="#ef4444" />
                  </View>
                  <Text style={[s.emptyTitle, { color: colors.foreground }]}>No Wallets Found</Text>
                  <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
                    Could not connect to blockchain API. Pull down to refresh or create a new wallet.
                  </Text>
                </Card>
              </AnimatedEntry>
            )}

            <AnimatedEntry delay={500}>
              <Card style={s.gasCard} elevated>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <View style={[s.chartIconWrap, { backgroundColor: "#f59e0b15" }]}>
                    <Feather name="zap" size={14} color="#f59e0b" />
                  </View>
                  <Text style={[s.gasTitle, { color: colors.foreground }]}>Network Gas Prices</Text>
                </View>
                {Object.keys(CHAIN_META).map((chain) => {
                  const gasGwei = getChainGwei(chain);
                  const gasUsd = getChainGasUsd(chain);
                  const speed = gasGwei > 50 ? "Fast" : gasGwei > 10 ? "Standard" : "Instant";
                  return (
                    <View key={chain} style={s.gasRow}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={[s.gasChainDot, { backgroundColor: chainColors[chain] || "#64748b" }]} />
                        <View>
                          <Text style={[s.gasChainName, { color: colors.foreground }]}>{chainDisplayName(chain)}</Text>
                          <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
                            {liveGasOracle ? "Live" : "Estimated"} · Chain {CHAIN_META[chain]?.chainId || "—"}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <Text style={[s.gasValue, { color: colors.mutedForeground }]}>{gasGwei} Gwei</Text>
                        <Text style={[s.gasSpeed, { color: colors.primary }]}>{speed}</Text>
                        <Text style={[s.gasCost, { color: colors.foreground }]}>${gasUsd.toFixed(3)}</Text>
                      </View>
                    </View>
                  );
                })}
              </Card>
            </AnimatedEntry>
          </View>
        )}
      </ScrollView>

      <FloatingActionButton icon="plus" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setModalMode("create"); }} />

      {/* Send Modal */}
      <Modal visible={modalMode === "send"} transparent animationType="slide" onRequestClose={() => setModalMode("none")}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: colors.card }]}>
            <View style={s.modalHandle} />
            <View style={s.modalTitleRow}>
              <Text style={[s.modalTitle, { color: colors.foreground }]}>Send Crypto</Text>
              <TouchableOpacity onPress={() => setModalMode("none")}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Network</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chainPicker}>
              {["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"].map((chain) => (
                <TouchableOpacity
                  key={chain}
                  style={[s.chainOption, { backgroundColor: sendChain === chain ? colors.primary + "20" : colors.muted, borderColor: sendChain === chain ? colors.primary : colors.border }]}
                  onPress={() => { Haptics.selectionAsync(); setSendChain(chain); }}
                  activeOpacity={0.7}
                >
                  <View>
                    <Text style={[s.chainOptionText, { color: sendChain === chain ? colors.primary : colors.foreground }]}>
                      {chainNativeSymbol(chain)}
                    </Text>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>{chainDisplayName(chain)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Recipient Address</Text>
            <TextInput style={[s.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} value={sendTo} onChangeText={setSendTo} placeholder="0x..." placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoCorrect={false} />

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Amount ({chainNativeSymbol(sendChain)})</Text>
            <TextInput style={[s.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} value={sendAmount} onChangeText={setSendAmount} placeholder="0.01" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" />

            <View style={[s.feeBreakdown, { backgroundColor: "rgba(59,130,246,0.06)" }]}>
              <View style={s.feeRow}>
                <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>System Fee (0.75%)</Text>
                <Text style={[s.feeValue, { color: "#f59e0b" }]}>{feePreview} {chainNativeSymbol(sendChain)}</Text>
              </View>
              <View style={s.feeRow}>
                <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>Net Amount Sent</Text>
                <Text style={[s.feeValue, { color: colors.profit }]}>{netPreview} {chainNativeSymbol(sendChain)}</Text>
              </View>
              <View style={s.feeRow}>
                <Feather name="zap" size={10} color="#f59e0b" />
                <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>Est. gas: {getChainGwei(sendChain)} Gwei (~${getChainGasUsd(sendChain).toFixed(3)})</Text>
              </View>
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.muted }]} onPress={() => setModalMode("none")} activeOpacity={0.7} disabled={sending}>
                <Text style={[s.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, s.sendBtn, { backgroundColor: colors.primary, opacity: sending ? 0.7 : 1 }]} onPress={handleSend} activeOpacity={0.7} disabled={sending}>
                {sending ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="send" size={14} color="#fff" /><Text style={[s.modalBtnText, { color: "#fff" }]}>Send</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Receive Modal */}
      <Modal visible={modalMode === "receive"} transparent animationType="slide" onRequestClose={() => setModalMode("none")}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: colors.card }]}>
            <View style={s.modalHandle} />
            <View style={s.modalTitleRow}>
              <Text style={[s.modalTitle, { color: colors.foreground }]}>Receive Crypto</Text>
              <TouchableOpacity onPress={() => setModalMode("none")}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <View style={[s.receiveIconWrap, { backgroundColor: colors.primary + "12" }]}>
              <Feather name="download" size={28} color={colors.primary} />
            </View>
            <Text style={[s.receiveLabel, { color: colors.mutedForeground }]}>Send funds to this address on any supported chain:</Text>
            <View style={[s.addressBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[s.addressText, { color: colors.foreground }]} selectable>{receiveAddress}</Text>
            </View>
            <View style={s.receiveSupportedChains}>
              {["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"].map((chain) => (
                <View key={chain} style={[s.receiveChainBadge, { backgroundColor: (chainColors[chain] || "#64748b") + "15" }]}>
                  <View style={[s.receiveChainDot, { backgroundColor: chainColors[chain] || "#64748b" }]} />
                  <Text style={[s.receiveChainText, { color: chainColors[chain] || "#64748b" }]}>{chainDisplayName(chain)}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={[s.doneBtn, { backgroundColor: colors.primary }]} onPress={() => { copyToClipboard(receiveAddress); setModalMode("none"); }} activeOpacity={0.7}>
              <Feather name="copy" size={16} color="#fff" />
              <Text style={[s.doneBtnText, { color: "#fff" }]}>Copy Address</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Transfer Modal */}
      <Modal visible={modalMode === "transfer"} transparent animationType="slide" onRequestClose={() => setModalMode("none")}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: colors.card }]}>
            <View style={s.modalHandle} />
            <View style={s.modalTitleRow}>
              <Text style={[s.modalTitle, { color: colors.foreground }]}>Transfer Between Wallets</Text>
              <TouchableOpacity onPress={() => setModalMode("none")}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>From Wallet</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chainPicker}>
              {allWalletAddresses.map((w) => (
                <TouchableOpacity
                  key={w.address}
                  style={[s.chainOption, { backgroundColor: transferFrom === w.address ? colors.primary + "20" : colors.muted, borderColor: transferFrom === w.address ? colors.primary : colors.border }]}
                  onPress={() => { Haptics.selectionAsync(); setTransferFrom(w.address); }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.chainOptionText, { color: transferFrom === w.address ? colors.primary : colors.foreground }]} numberOfLines={1}>{w.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>To Wallet</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chainPicker}>
              {allWalletAddresses.filter((w) => w.address !== transferFrom).map((w) => (
                <TouchableOpacity
                  key={w.address}
                  style={[s.chainOption, { backgroundColor: transferTo === w.address ? "#8b5cf620" : colors.muted, borderColor: transferTo === w.address ? "#8b5cf6" : colors.border }]}
                  onPress={() => { Haptics.selectionAsync(); setTransferTo(w.address); }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.chainOptionText, { color: transferTo === w.address ? "#8b5cf6" : colors.foreground }]} numberOfLines={1}>{w.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Network</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chainPicker}>
              {["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"].map((chain) => (
                <TouchableOpacity key={chain} style={[s.chainOption, { backgroundColor: sendChain === chain ? colors.primary + "20" : colors.muted, borderColor: sendChain === chain ? colors.primary : colors.border }]} onPress={() => { Haptics.selectionAsync(); setSendChain(chain); }}>
                  <View>
                    <Text style={[s.chainOptionText, { color: sendChain === chain ? colors.primary : colors.foreground }]}>{chainNativeSymbol(chain)}</Text>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>{chainDisplayName(chain)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Amount ({chainNativeSymbol(sendChain)})</Text>
            <TextInput style={[s.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} value={transferAmount} onChangeText={setTransferAmount} placeholder="0.01" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" />

            <View style={[s.feeBreakdown, { backgroundColor: "rgba(139,92,246,0.06)" }]}>
              <View style={s.feeRow}>
                <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>System Fee (0.75%)</Text>
                <Text style={[s.feeValue, { color: "#f59e0b" }]}>{transferAmount ? (parseFloat(transferAmount || "0") * 0.0075).toFixed(6) : "0"} {chainNativeSymbol(sendChain)}</Text>
              </View>
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.muted }]} onPress={() => setModalMode("none")} activeOpacity={0.7} disabled={transferring}>
                <Text style={[s.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: "#8b5cf6", opacity: transferring ? 0.7 : 1 }]} onPress={handleTransfer} activeOpacity={0.7} disabled={transferring}>
                {transferring ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="repeat" size={14} color="#fff" /><Text style={[s.modalBtnText, { color: "#fff" }]}>Transfer</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Fund Wallet Modal */}
      <Modal visible={modalMode === "fund"} transparent animationType="slide" onRequestClose={() => { setModalMode("none"); setFundMode("record"); setExtPrivateKey(""); setExtSourceAddress(""); setExtAmount(""); }}>
        <View style={s.modalOverlay}>
          <ScrollView style={[s.modalContent, { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" }]} contentContainerStyle={{ padding: 24 }}>
            <View style={s.modalHandle} />
            <View style={s.modalTitleRow}>
              <Text style={[s.modalTitle, { color: colors.foreground }]}>Fund Wallet</Text>
              <TouchableOpacity onPress={() => { setModalMode("none"); setFundMode("record"); setExtPrivateKey(""); setExtSourceAddress(""); setExtAmount(""); }}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>

            <View style={[s.receiveIconWrap, { backgroundColor: "#22c55e12" }]}>
              <Feather name="plus-circle" size={28} color="#22c55e" />
            </View>

            {/* Mode Toggle */}
            <View style={{ flexDirection: "row", backgroundColor: colors.muted, borderRadius: 10, padding: 3, marginBottom: 20 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: fundMode === "record" ? colors.card : "transparent" }}
                onPress={() => { Haptics.selectionAsync(); setFundMode("record"); }}
                activeOpacity={0.8}
              >
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: fundMode === "record" ? colors.foreground : colors.mutedForeground }}>Record Deposit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: fundMode === "external" ? colors.card : "transparent" }}
                onPress={() => { Haptics.selectionAsync(); setFundMode("external"); }}
                activeOpacity={0.8}
              >
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: fundMode === "external" ? colors.foreground : colors.mutedForeground }}>Send from External Wallet</Text>
              </TouchableOpacity>
            </View>

            {fundMode === "record" ? (
              <>
                <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Deposit Network</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chainPicker}>
                  {["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"].map((chain) => (
                    <TouchableOpacity
                      key={chain}
                      style={[s.chainOption, { backgroundColor: fundChain === chain ? "#22c55e20" : colors.muted, borderColor: fundChain === chain ? "#22c55e" : colors.border }]}
                      onPress={() => { Haptics.selectionAsync(); setFundChain(chain); }}
                      activeOpacity={0.7}
                    >
                      <View>
                        <Text style={[s.chainOptionText, { color: fundChain === chain ? "#22c55e" : colors.foreground }]}>{chainNativeSymbol(chain)}</Text>
                        <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>{chainDisplayName(chain)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Deposit To</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chainPicker}>
                  {allWalletAddresses.map((w) => (
                    <TouchableOpacity
                      key={w.address}
                      style={[s.chainOption, { backgroundColor: fundWalletAddr === w.address ? "#22c55e20" : colors.muted, borderColor: fundWalletAddr === w.address ? "#22c55e" : colors.border }]}
                      onPress={() => { Haptics.selectionAsync(); setFundWalletAddr(w.address); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.chainOptionText, { color: fundWalletAddr === w.address ? "#22c55e" : colors.foreground }]} numberOfLines={1}>{w.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Amount ({chainNativeSymbol(fundChain)})</Text>
                <TextInput style={[s.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} value={fundAmount} onChangeText={setFundAmount} placeholder="1.0" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" />

                <View style={[s.feeBreakdown, { backgroundColor: "rgba(34,197,94,0.06)" }]}>
                  <View style={s.feeRow}>
                    <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>Funding Fee (2%)</Text>
                    <Text style={[s.feeValue, { color: "#f59e0b" }]}>{fundFee} {chainNativeSymbol(fundChain)}</Text>
                  </View>
                  <View style={s.feeRow}>
                    <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>Net Credited</Text>
                    <Text style={[s.feeValue, { color: colors.profit }]}>{fundNet} {chainNativeSymbol(fundChain)}</Text>
                  </View>
                  <View style={s.feeRow}>
                    <Feather name="info" size={10} color={colors.mutedForeground} />
                    <Text style={[s.feeLabel, { color: colors.mutedForeground, flex: 1 }]}>2% fee sent to system wallet for platform maintenance</Text>
                  </View>
                </View>

                <Text style={[s.sectionTitle, { color: colors.foreground, marginTop: 16, marginBottom: 10 }]}>Buy Crypto from Exchanges</Text>
                <Text style={[s.receiveLabel, { color: colors.mutedForeground, textAlign: "left", marginBottom: 10 }]}>
                  Purchase crypto on an exchange, then withdraw to your wallet address.
                </Text>

                {exchanges.map((ex) => (
                  <TouchableOpacity
                    key={ex.name}
                    style={[s.exchangeRow, { backgroundColor: colors.muted, borderColor: colors.border }]}
                    onPress={() => Linking.openURL(ex.url)}
                    activeOpacity={0.7}
                  >
                    <View style={[s.exchangeIconWrap, { backgroundColor: colors.primary + "15" }]}>
                      <Text style={[s.exchangeIconText, { color: colors.primary }]}>{ex.icon}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.exchangeName, { color: colors.foreground }]}>{ex.name}</Text>
                      <Text style={[s.exchangeDesc, { color: colors.mutedForeground }]}>{ex.description}</Text>
                    </View>
                    <Feather name="external-link" size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ))}

                <View style={[s.modalActions, { marginTop: 16 }]}>
                  <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.muted }]} onPress={() => setModalMode("none")} activeOpacity={0.7} disabled={funding}>
                    <Text style={[s.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.modalBtn, { backgroundColor: "#22c55e", opacity: funding ? 0.7 : 1 }]} onPress={handleFund} activeOpacity={0.7} disabled={funding}>
                    {funding ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="plus-circle" size={14} color="#fff" /><Text style={[s.modalBtnText, { color: "#fff" }]}>Record Deposit</Text></>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {/* Security Warning */}
                <View style={{ backgroundColor: "#f59e0b15", borderWidth: 1, borderColor: "#f59e0b40", borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: "row", gap: 10 }}>
                  <Feather name="shield" size={16} color="#f59e0b" style={{ marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#f59e0b", marginBottom: 2 }}>Security Notice</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#f59e0b", lineHeight: 16 }}>
                      Your private key is transmitted securely and used ephemerally to sign the transaction on the server. It is never logged, stored, or retained. Use only on trusted networks. Never share your private key.
                    </Text>
                  </View>
                </View>

                <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Network</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chainPicker}>
                  {["ethereum", "polygon", "bsc", "avalanche"].map((chain) => (
                    <TouchableOpacity
                      key={chain}
                      style={[s.chainOption, { backgroundColor: extChain === chain ? "#22c55e20" : colors.muted, borderColor: extChain === chain ? "#22c55e" : colors.border }]}
                      onPress={() => { Haptics.selectionAsync(); setExtChain(chain); }}
                      activeOpacity={0.7}
                    >
                      <View>
                        <Text style={[s.chainOptionText, { color: extChain === chain ? "#22c55e" : colors.foreground }]}>{chainNativeSymbol(chain)}</Text>
                        <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>{chainDisplayName(chain)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Source Wallet Address</Text>
                <TextInput
                  style={[s.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
                  value={extSourceAddress}
                  onChangeText={setExtSourceAddress}
                  placeholder="0x..."
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Private Key</Text>
                <TextInput
                  style={[s.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
                  value={extPrivateKey}
                  onChangeText={setExtPrivateKey}
                  placeholder="Enter private key (0x...)"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Destination Wallet</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chainPicker}>
                  {allWalletAddresses.map((w) => (
                    <TouchableOpacity
                      key={w.address}
                      style={[s.chainOption, { backgroundColor: fundWalletAddr === w.address ? "#22c55e20" : colors.muted, borderColor: fundWalletAddr === w.address ? "#22c55e" : colors.border }]}
                      onPress={() => { Haptics.selectionAsync(); setFundWalletAddr(w.address); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.chainOptionText, { color: fundWalletAddr === w.address ? "#22c55e" : colors.foreground }]} numberOfLines={1}>{w.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Amount ({chainNativeSymbol(extChain)})</Text>
                <TextInput
                  style={[s.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
                  value={extAmount}
                  onChangeText={setExtAmount}
                  placeholder="1.0"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                />

                <View style={[s.feeBreakdown, { backgroundColor: "rgba(34,197,94,0.06)" }]}>
                  <View style={s.feeRow}>
                    <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>Amount to Send</Text>
                    <Text style={[s.feeValue, { color: colors.foreground }]}>{extAmount || "0"} {chainNativeSymbol(extChain)}</Text>
                  </View>
                  <View style={s.feeRow}>
                    <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>Funding Fee (2%)</Text>
                    <Text style={[s.feeValue, { color: "#f59e0b" }]}>{extFee} {chainNativeSymbol(extChain)}</Text>
                  </View>
                  <View style={s.feeRow}>
                    <Text style={[s.feeLabel, { color: colors.mutedForeground }]}>Net Credited</Text>
                    <Text style={[s.feeValue, { color: colors.profit }]}>{extNet} {chainNativeSymbol(extChain)}</Text>
                  </View>
                  <View style={s.feeRow}>
                    <Feather name="info" size={10} color={colors.mutedForeground} />
                    <Text style={[s.feeLabel, { color: colors.mutedForeground, flex: 1 }]}>2% fee sent to system fee wallet for platform maintenance</Text>
                  </View>
                </View>

                <View style={[s.modalActions, { marginTop: 16 }]}>
                  <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.muted }]} onPress={() => { setModalMode("none"); setFundMode("record"); setExtPrivateKey(""); setExtSourceAddress(""); setExtAmount(""); }} activeOpacity={0.7} disabled={extFunding}>
                    <Text style={[s.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.modalBtn, { backgroundColor: "#22c55e", opacity: extFunding ? 0.7 : 1 }]} onPress={handleFundFromExternal} activeOpacity={0.7} disabled={extFunding}>
                    {extFunding ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="send" size={14} color="#fff" /><Text style={[s.modalBtnText, { color: "#fff" }]}>Send & Fund</Text></>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Create Wallet Modal */}
      <Modal visible={modalMode === "create"} transparent animationType="slide" onRequestClose={() => setModalMode("none")}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: colors.card }]}>
            <View style={s.modalHandle} />
            <View style={s.modalTitleRow}>
              <Text style={[s.modalTitle, { color: colors.foreground }]}>Create New Wallet</Text>
              <TouchableOpacity onPress={() => setModalMode("none")}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <View style={[s.createIconWrap, { backgroundColor: colors.primary + "12" }]}>
              <Feather name="plus-circle" size={32} color={colors.primary} />
            </View>

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Wallet Name</Text>
            <TextInput style={[s.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} value={newWalletName} onChangeText={setNewWalletName} placeholder="e.g. Trading Bot Alpha" placeholderTextColor={colors.mutedForeground} />

            <Text style={[s.inputLabel, { color: colors.mutedForeground }]}>Primary Network</Text>
            <View style={s.createChainGrid}>
              {["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"].map((chain) => (
                <TouchableOpacity
                  key={chain}
                  style={[s.createChainOption, {
                    backgroundColor: newWalletChain === chain ? (chainColors[chain] || "#64748b") + "20" : colors.muted,
                    borderColor: newWalletChain === chain ? chainColors[chain] || "#64748b" : colors.border,
                  }]}
                  onPress={() => { Haptics.selectionAsync(); setNewWalletChain(chain); }}
                >
                  <View style={[s.createChainDot, { backgroundColor: chainColors[chain] || "#64748b" }]} />
                  <View>
                    <Text style={[s.createChainText, { color: newWalletChain === chain ? chainColors[chain] || "#64748b" : colors.foreground }]}>{chainNativeSymbol(chain)}</Text>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>{chainDisplayName(chain)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[s.createNote, { backgroundColor: "rgba(59,130,246,0.06)" }]}>
              <Feather name="info" size={14} color={colors.primary} />
              <Text style={[s.createNoteText, { color: colors.mutedForeground }]}>A new HD wallet will be generated with a unique private key and mnemonic phrase. Store your recovery phrase safely.</Text>
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.muted }]} onPress={() => setModalMode("none")} activeOpacity={0.7} disabled={creating}>
                <Text style={[s.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.primary, opacity: creating ? 0.7 : 1 }]} onPress={handleCreateWallet} activeOpacity={0.7} disabled={creating}>
                {creating ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="plus" size={14} color="#fff" /><Text style={[s.modalBtnText, { color: "#fff" }]}>Create Wallet</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Agent Wallet Modal */}
      <Modal visible={modalMode === "deleteAgent"} transparent animationType="fade" onRequestClose={() => setModalMode("none")}>
        <View style={s.modalOverlay}>
          <View style={[s.deleteModal, { backgroundColor: colors.cardElevated }]}>
            <View style={[s.deleteIconWrap, { backgroundColor: "rgba(239,68,68,0.1)" }]}>
              <Feather name="alert-triangle" size={28} color="#ef4444" />
            </View>
            <Text style={[s.deleteTitle, { color: colors.foreground }]}>Remove Agent Wallet</Text>
            {deleteTarget && (
              <>
                <Text style={[s.deleteDesc, { color: colors.mutedForeground }]}>
                  Remove <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>{deleteTarget.agentName}</Text> wallet?
                </Text>
                <View style={[s.deleteSummary, { backgroundColor: "rgba(239,68,68,0.05)", borderColor: "#ef444420" }]}>
                  <View style={s.deleteStatRow}>
                    <Text style={[s.deleteStatLabel, { color: colors.mutedForeground }]}>Address</Text>
                    <Text style={[s.deleteStatValue, { color: colors.foreground }]}>{shortAddr(deleteTarget.wallet.address)}</Text>
                  </View>
                  <View style={s.deleteStatRow}>
                    <Text style={[s.deleteStatLabel, { color: colors.mutedForeground }]}>Revenue</Text>
                    <Text style={[s.deleteStatValue, { color: colors.profit }]}>{formatCurrency(deleteTarget.wallet.totalReceived)}</Text>
                  </View>
                  <View style={s.deleteStatRow}>
                    <Text style={[s.deleteStatLabel, { color: colors.mutedForeground }]}>Net Held</Text>
                    <Text style={[s.deleteStatValue, { color: deleteTarget.wallet.netRevenue >= 0 ? colors.profit : colors.loss }]}>{formatCurrency(deleteTarget.wallet.netRevenue)}</Text>
                  </View>
                  <View style={s.deleteStatRow}>
                    <Text style={[s.deleteStatLabel, { color: colors.mutedForeground }]}>Strategy</Text>
                    <Text style={[s.deleteStatValue, { color: "#8b5cf6" }]}>{deleteTarget.strategy}</Text>
                  </View>
                </View>
              </>
            )}
            <View style={s.deleteActions}>
              <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.border }]} onPress={() => { setDeleteTarget(null); setModalMode("none"); }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmDeleteBtn, { backgroundColor: "#ef4444" }]} onPress={handleDeleteAgentWallet}>
                <Feather name="trash-2" size={14} color="#fff" />
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  totalCard: { padding: 24, alignItems: "center" },
  totalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: 12 },
  totalIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  totalLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 4 },
  totalValue: { fontSize: 34, fontFamily: "Inter_700Bold", marginBottom: 8, letterSpacing: -1 },
  totalStatsRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  totalStat: { alignItems: "center" },
  totalStatNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  totalStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  totalStatDivider: { width: 1, height: 24 },
  tabBar: { flexDirection: "row", paddingHorizontal: 20, gap: 8, marginTop: 16, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: "transparent" },
  tabText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  activityCard: { padding: 16, marginBottom: 4 },
  activityHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chartIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  activityTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  activityChartWrap: { marginTop: 12, alignItems: "center" },
  activityLabels: { flexDirection: "row", justifyContent: "space-between", width: 280, marginTop: 4 },
  activityDayLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },
  activityStatsRow: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 12 },
  actStat: { alignItems: "center" },
  actStatValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  actStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  walletsList: { paddingHorizontal: 20, gap: 12, marginTop: 12 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4, marginTop: 8 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  countText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  walletCard: { padding: 16 },
  walletHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  walletLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  walletIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  walletName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  walletAddress: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  walletRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  walletBalance: { fontSize: 16, fontFamily: "Inter_700Bold" },
  chainCount: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  chevronWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  expandedSection: { marginTop: 14 },
  divider: { height: 1, marginBottom: 12 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 14 },
  fullAddress: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  walletStatsRow: { flexDirection: "row", borderRadius: 10, padding: 12, marginBottom: 14 },
  walletStat: { flex: 1, alignItems: "center" },
  walletStatValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  walletStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  walletStatDivider: { width: 1, height: "80%" as any, alignSelf: "center" },
  chainBreakdownHeader: { marginBottom: 8 },
  chainBreakdownTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  chainSection: { marginBottom: 4 },
  agentInfoRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 10, borderRadius: 8, marginBottom: 12 },
  agentInfoItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  agentInfoText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  tokenRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  tokenLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  tokenIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tokenSymbolText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  tokenNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tokenName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pctBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  pctText: { fontSize: 9, fontFamily: "Inter_700Bold" },
  tokenChain: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  tokenRight: { alignItems: "flex-end" },
  tokenValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tokenUsd: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  subTokensWrap: { marginLeft: 46, marginBottom: 8, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.06)" },
  subTokenRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  subTokenLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  subTokenDot: { width: 5, height: 5, borderRadius: 3 },
  subTokenName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  subTokenChainLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },
  subTokenBalance: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  miniChartWrap: { marginBottom: 12 },
  miniChartLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 6 },
  walletActions: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  walletBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, minWidth: 70 },
  walletBtnTextWhite: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  walletBtnTextDark: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  agentSummaryCard: { padding: 14, marginBottom: 4 },
  agentSummaryRow: { flexDirection: "row", justifyContent: "space-between" },
  agentSummaryItem: { alignItems: "center", flex: 1 },
  agentSummaryVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  agentSummaryLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  emptyCard: { padding: 40, alignItems: "center", gap: 12 },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  gasCard: { padding: 16, marginTop: 8 },
  gasTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  gasRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.03)" },
  gasChainDot: { width: 8, height: 8, borderRadius: 4 },
  gasChainName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  gasValue: { fontSize: 11, fontFamily: "Inter_400Regular" },
  gasSpeed: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  gasCost: { fontSize: 11, fontFamily: "Inter_700Bold", minWidth: 40, textAlign: "right" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", alignSelf: "center", marginBottom: 16 },
  modalTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  inputLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
  chainPicker: { marginBottom: 14 },
  chainOption: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, marginRight: 8 },
  chainOptionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 14 },
  feeBreakdown: { padding: 12, borderRadius: 10, marginBottom: 14, gap: 6 },
  feeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 },
  feeLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  feeValue: { fontSize: 11, fontFamily: "Inter_700Bold" },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  sendBtn: {},
  modalBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  receiveIconWrap: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 16 },
  receiveLabel: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 14, textAlign: "center" },
  addressBox: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  addressText: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  receiveSupportedChains: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 16 },
  receiveChainBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  receiveChainDot: { width: 6, height: 6, borderRadius: 3 },
  receiveChainText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  doneBtn: { paddingVertical: 14, borderRadius: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  doneBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  createIconWrap: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 16 },
  createChainGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  createChainOption: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  createChainDot: { width: 8, height: 8, borderRadius: 4 },
  createChainText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  createNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, marginBottom: 14 },
  createNoteText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },
  exchangeRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  exchangeIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  exchangeIconText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  exchangeName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  exchangeDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  deleteModal: { margin: 20, borderRadius: 20, padding: 24, alignItems: "center" },
  deleteIconWrap: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  deleteTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 8 },
  deleteDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 16, lineHeight: 20 },
  deleteSummary: { width: "100%", borderRadius: 12, padding: 14, borderWidth: 1, marginBottom: 20, gap: 8 },
  deleteStatRow: { flexDirection: "row", justifyContent: "space-between" },
  deleteStatLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  deleteStatValue: { fontSize: 12, fontFamily: "Inter_700Bold" },
  deleteActions: { flexDirection: "row", gap: 10, width: "100%" },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  confirmDeleteBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
});
