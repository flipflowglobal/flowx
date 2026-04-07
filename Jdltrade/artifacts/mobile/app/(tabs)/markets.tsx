import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Platform, StyleSheet, ActivityIndicator, Alert,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { JDLHeader } from "@/components/JDLHeader";
import { useScreenWatchdog } from "@/hooks/useScreenWatchdog";
import { useColors } from "@/hooks/useColors";
import { AnimatedEntry } from "@/components/AnimatedEntry";
import CandlestickChart from "@/components/CandlestickChart";
import SparklineChart from "@/components/SparklineChart";
import {
  getCandles, getMarketTicker, getOrderBook, getRecentTrades,
  placeMarketOrder, getMarketOrders, cancelMarketOrder,
  type Candle, type OrderBook, type MarketTicker, type RecentTrade, type MarketOrder,
} from "@/lib/api";

// ── Token registry ─────────────────────────────────────────────────────────
const TOKENS = [
  { symbol: "ETH",   name: "Ethereum",  color: "#627EEA" },
  { symbol: "BTC",   name: "Bitcoin",   color: "#F7931A" },
  { symbol: "BNB",   name: "BNB",       color: "#F3BA2F" },
  { symbol: "SOL",   name: "Solana",    color: "#9945FF" },
  { symbol: "MATIC", name: "Polygon",   color: "#8247E5" },
  { symbol: "AVAX",  name: "Avalanche", color: "#E84142" },
  { symbol: "ARB",   name: "Arbitrum",  color: "#28A0F0" },
  { symbol: "LINK",  name: "Chainlink", color: "#375BD2" },
];

const INTERVALS = ["1s","5s","30s","1m","5m","15m","1h","4h","1d"] as const;
type Interval = typeof INTERVALS[number];

type TradeTab = "trade" | "book" | "trades" | "history";
type OrderSide = "buy" | "sell";
type OrderType = "market" | "limit" | "stop";

// Simulated wallet balances for demo trading
const SIM_BALANCES: Record<string, number> = {
  AUD: 50000, ETH: 2.5, BTC: 0.18, BNB: 8.4, SOL: 45, MATIC: 12000, AVAX: 55, ARB: 3200, LINK: 280,
};

function fmtP(n: number): string {
  if (!n) return "$0.00";
  if (n >= 10000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 100)   return "$" + n.toFixed(2);
  if (n >= 1)     return "$" + n.toFixed(4);
  return "$" + n.toFixed(6);
}

function fmtAUD(n: number): string {
  return "A$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtVol(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  return (n / 1e3).toFixed(1) + "K";
}

function fmtPct(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function fmtSz(n: number): string {
  if (n >= 1000) return n.toFixed(0);
  if (n >= 10)   return n.toFixed(2);
  return n.toFixed(4);
}

function fmtAge(secs: number): string {
  if (secs < 60)   return secs + "s ago";
  if (secs < 3600) return Math.floor(secs / 60) + "m ago";
  return Math.floor(secs / 3600) + "h ago";
}

function pollMs(iv: Interval): number {
  if (["1s","5s"].includes(iv)) return 1500;
  if (["30s","1m","5m"].includes(iv)) return 5000;
  return 20000;
}

// ── Candle OHLCV tooltip ───────────────────────────────────────────────────
function OHLCVBar({ candle, aud }: { candle: Candle | null; aud: number }) {
  if (!candle) return null;
  const isUp = candle.close >= candle.open;
  const clr  = isUp ? "#26a69a" : "#ef5350";
  const pairs = [
    ["O", candle.open], ["H", candle.high],
    ["L", candle.low],  ["C", candle.close],
  ] as [string, number][];
  return (
    <View style={st.ohlcvBar}>
      {pairs.map(([lbl, v]) => (
        <Text key={lbl} style={[st.ohlcvItem, { color: lbl === "H" ? "#26a69a" : lbl === "L" ? "#ef5350" : clr }]}>
          <Text style={st.ohlcvLbl}>{lbl}: </Text>
          {fmtP(v as number)}
        </Text>
      ))}
      <Text style={st.ohlcvVol}>Vol: {fmtVol(candle.volume)}</Text>
    </View>
  );
}

// ── Order book row ─────────────────────────────────────────────────────────
function BookRow({ price, size, total, depthPct, side }: {
  price: number; size: number; total: number; depthPct: number; side: "bid" | "ask";
}) {
  const bgColor = side === "bid" ? "rgba(38,166,154,0.08)" : "rgba(239,83,80,0.08)";
  const textColor = side === "bid" ? "#26a69a" : "#ef5350";
  return (
    <View style={st.bookRow}>
      <View style={[st.bookDepthBar, { right: 0, width: `${depthPct}%` as any, backgroundColor: bgColor }]} />
      <Text style={[st.bookPrice, { color: textColor }]}>{fmtP(price)}</Text>
      <Text style={st.bookSize}>{fmtSz(size)}</Text>
      <Text style={st.bookTotal}>{fmtSz(total)}</Text>
    </View>
  );
}

// ── Order history row ──────────────────────────────────────────────────────
function OrderRow({ order, onCancel }: { order: MarketOrder; onCancel: (id: string) => void }) {
  const isBuy  = order.side === "buy";
  const filled = order.status === "filled";
  const pend   = order.status === "pending";
  return (
    <View style={st.orderRow}>
      <View style={st.orderLeft}>
        <View style={[st.sideBadge, { backgroundColor: isBuy ? "rgba(38,166,154,0.15)" : "rgba(239,83,80,0.15)" }]}>
          <Text style={{ color: isBuy ? "#26a69a" : "#ef5350", fontSize: 10, fontFamily: "Inter_700Bold" }}>
            {order.side.toUpperCase()}
          </Text>
        </View>
        <Text style={st.orderSymbol}>{order.symbol}/AUD</Text>
        <Text style={st.orderType}>{order.type}</Text>
      </View>
      <View style={st.orderMid}>
        <Text style={st.orderAmt}>{order.amount} {order.symbol}</Text>
        <Text style={st.orderPriceText}>
          @ {order.filledPrice ? fmtP(order.filledPrice) : fmtP(order.limitPrice ?? 0)}
        </Text>
      </View>
      <View style={st.orderRight}>
        <Text style={[st.orderStatus, {
          color: filled ? "#26a69a" : pend ? "#f59e0b" : "#6b7280"
        }]}>
          {order.status.toUpperCase()}
        </Text>
        {pend && (
          <TouchableOpacity onPress={() => onCancel(order.id)} style={st.cancelBtn}>
            <Feather name="x" size={12} color="#ef5350" />
          </TouchableOpacity>
        )}
        <Text style={st.orderFee}>Fee: {fmtAUD(order.feeAUD)}</Text>
      </View>
    </View>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────
export default function MarketsScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Selection state
  const [symbol,   setSymbol] = useState("ETH");
  const [interval, setIv]     = useState<Interval>("5m");
  const [tab,      setTab]    = useState<TradeTab>("trade");

  // Chart data
  const [candles,       setCandles]       = useState<Candle[]>([]);
  const [ticker,        setTicker]        = useState<MarketTicker | null>(null);
  const [orderBook,     setOrderBook]     = useState<OrderBook | null>(null);
  const [recentTrades,  setRecentTrades]  = useState<RecentTrade[]>([]);
  const [myOrders,      setMyOrders]      = useState<MarketOrder[]>([]);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [chartType,     setChartType]     = useState<"candlestick" | "line">("candlestick");
  const [showMA20,      setShowMA20]      = useState(true);
  const [showMA50,      setShowMA50]      = useState(true);

  // Token sparkline histories (24h price ticks)
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});

  // Trade form
  const [side,         setSide]         = useState<OrderSide>("buy");
  const [orderType,    setOrderType]    = useState<OrderType>("market");
  const [amount,       setAmount]       = useState("");
  const [limitPrice,   setLimitPrice]   = useState("");
  const [stopPrice,    setStopPrice]    = useState("");
  const [slEnabled,    setSlEnabled]    = useState(false);
  const [tpEnabled,    setTpEnabled]    = useState(false);
  const [slPrice,      setSlPrice]      = useState("");
  const [tpPrice,      setTpPrice]      = useState("");
  const [placing,      setPlacing]      = useState(false);
  const [lastFill,     setLastFill]     = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [cRes, tRes, bRes, trRes, oRes] = await Promise.allSettled([
        getCandles(symbol, interval, 90),
        getMarketTicker(symbol),
        getOrderBook(symbol, 12),
        getRecentTrades(symbol, 25),
        getMarketOrders(symbol),
      ]);
      if (cRes.status  === "fulfilled") setCandles(cRes.value.candles);
      if (tRes.status  === "fulfilled") setTicker(tRes.value);
      if (bRes.status  === "fulfilled") setOrderBook(bRes.value);
      if (trRes.status === "fulfilled") setRecentTrades(trRes.value.trades);
      if (oRes.status  === "fulfilled") setMyOrders(oRes.value.orders);
    } catch {}
    setLoading(false);
  }, [symbol, interval]);

  // Fetch sparklines for all tokens (1d candles, 30 data points)
  const fetchSparklines = useCallback(async () => {
    const results = await Promise.allSettled(
      TOKENS.map(t => getCandles(t.symbol, "1h", 24).then(r => ({ sym: t.symbol, data: r.candles.map(c => c.close) })))
    );
    const m: Record<string, number[]> = {};
    results.forEach(r => { if (r.status === "fulfilled") m[r.value.sym] = r.value.data; });
    setSparklines(m);
  }, []);

  useEffect(() => { fetchSparklines(); }, []);

  useEffect(() => {
    setLoading(true);
    fetchAll();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = globalThis.setInterval(fetchAll, pollMs(interval));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, fetchAll]);

  const watchdog = useScreenWatchdog({ fetch: fetchAll, screenName: "Markets", intervalMs: 15_000, staleLimitMs: 45_000 });

  // ── Trading ───────────────────────────────────────────────────────────────
  const currentPrice = ticker?.price ?? candles[candles.length - 1]?.close ?? 0;
  const audRate      = ticker?.usdToAud ?? 1.55;
  const priceAUD     = currentPrice * audRate;

  const amtNum    = parseFloat(amount) || 0;
  const execPrice = orderType === "market" ? currentPrice : (parseFloat(limitPrice) || currentPrice);
  const notional  = amtNum * execPrice;
  const notionalAUD = notional * audRate;
  const fee       = notionalAUD * 0.0075;

  const availAUD    = SIM_BALANCES.AUD;
  const availToken  = SIM_BALANCES[symbol] ?? 0;

  function handleQuickFill(pct: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (side === "buy") {
      const maxAmt = (availAUD * pct / 100) / (execPrice * audRate || 1);
      setAmount(maxAmt.toFixed(4));
    } else {
      setAmount(((availToken * pct) / 100).toFixed(4));
    }
  }

  async function handlePlaceOrder() {
    if (!amtNum || amtNum <= 0) { Alert.alert("Invalid Amount", "Please enter a valid amount to trade."); return; }
    if (orderType !== "market" && !parseFloat(limitPrice)) {
      Alert.alert("Missing Price", "Please enter a limit price."); return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPlacing(true);
    try {
      const params: any = { symbol, side, type: orderType, amount: amtNum };
      if (orderType !== "market") params.limitPrice = parseFloat(limitPrice);
      if (slEnabled && slPrice)   params.stopLoss   = parseFloat(slPrice);
      if (tpEnabled && tpPrice)   params.takeProfit = parseFloat(tpPrice);
      const res = await placeMarketOrder(params);
      setLastFill(res.message);
      setAmount("");
      setLimitPrice("");
      setSlPrice("");
      setTpPrice("");
      fetchAll();
      setTimeout(() => setLastFill(null), 4000);
    } catch (e: any) {
      Alert.alert("Order Failed", e.message || "Could not place order.");
    }
    setPlacing(false);
  }

  async function handleCancelOrder(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { await cancelMarketOrder(id); fetchAll(); } catch {}
  }

  // ── Render sub-sections ───────────────────────────────────────────────────
  const topPad = Platform.OS === "web" ? 16 : insets.top;

  function renderTokenStrip() {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.tokenStrip}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 4 }}>
        {TOKENS.map(t => {
          const isActive  = t.symbol === symbol;
          const tkr       = t.symbol === symbol ? ticker : null;
          const sparks    = sparklines[t.symbol] ?? [];
          const chg       = tkr?.change24h ?? 0;
          const isPos     = chg >= 0;
          return (
            <TouchableOpacity key={t.symbol}
              onPress={() => { setSymbol(t.symbol); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[st.tokenCard, isActive && { borderColor: t.color, borderWidth: 1.5, backgroundColor: t.color + "12" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[st.tokenDot, { backgroundColor: t.color }]}>
                  <Text style={st.tokenDotTxt}>{t.symbol[0]}</Text>
                </View>
                <View>
                  <Text style={[st.tokenSym, { color: isActive ? t.color : colors.foreground }]}>{t.symbol}</Text>
                  <Text style={st.tokenName}>{t.name}</Text>
                </View>
              </View>
              {sparks.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <SparklineChart data={sparks} positive={isPos} width={88} height={24} />
                </View>
              )}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                {tkr ? (
                  <>
                    <Text style={[st.tokenPrice, { color: colors.foreground }]}>{fmtP(tkr.price)}</Text>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: isPos ? "#26a69a" : "#ef5350" }}>
                      {fmtPct(chg)}
                    </Text>
                  </>
                ) : (
                  <Text style={st.tokenPrice}>—</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  }

  function renderPairHeader() {
    const tok = TOKENS.find(t => t.symbol === symbol)!;
    const chg24 = ticker?.change24h ?? 0;
    const isPos = chg24 >= 0;
    return (
      <View style={st.pairHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={[st.pairDot, { backgroundColor: tok.color }]}>
            <Text style={st.pairDotTxt}>{symbol[0]}</Text>
          </View>
          <View>
            <Text style={[st.pairTitle, { color: colors.foreground }]}>{symbol}/AUD</Text>
            <Text style={st.pairSub}>{tok.name}</Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[st.pairPrice, { color: isPos ? "#26a69a" : "#ef5350" }]}>
            {ticker ? fmtAUD(ticker.priceAUD) : "—"}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ color: isPos ? "#26a69a" : "#ef5350", fontSize: 11, fontFamily: "Inter_600SemiBold" }}>
              {fmtPct(chg24)}
            </Text>
            {ticker && (
              <Text style={st.pairUSD}>{fmtP(ticker.price)} USD</Text>
            )}
          </View>
        </View>
      </View>
    );
  }

  function renderStats() {
    if (!ticker) return null;
    const stats = [
      { label: "24H High", value: fmtP(ticker.high24h), color: "#26a69a" },
      { label: "24H Low",  value: fmtP(ticker.low24h),  color: "#ef5350" },
      { label: "Volume",   value: fmtVol(ticker.volume24h) },
      { label: "Bid",      value: fmtP(ticker.bid) },
      { label: "Ask",      value: fmtP(ticker.ask) },
      { label: "Spread",   value: ticker.spreadPct.toFixed(3) + "%" },
    ];
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.statsRow}>
        {stats.map(s => (
          <View key={s.label} style={st.statItem}>
            <Text style={st.statLabel}>{s.label}</Text>
            <Text style={[st.statVal, s.color ? { color: s.color } : { color: colors.foreground }]}>
              {s.value}
            </Text>
          </View>
        ))}
      </ScrollView>
    );
  }

  function renderIntervalPills() {
    return (
      <View style={st.intervalRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 4, paddingLeft: 16 }}>
          {INTERVALS.map(iv => (
            <TouchableOpacity key={iv}
              onPress={() => { setIv(iv); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[st.ivPill, interval === iv && { backgroundColor: "#3b82f6" }]}>
              <Text style={[st.ivPillTxt, interval === iv && { color: "white" }]}>
                {iv.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={st.chartToggles}>
          <TouchableOpacity onPress={() => setShowMA20(v => !v)}
            style={[st.togglePill, showMA20 && { backgroundColor: "#3b82f620" }]}>
            <Text style={[st.toggleTxt, { color: showMA20 ? "#3b82f6" : "#6b7280" }]}>MA20</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMA50(v => !v)}
            style={[st.togglePill, showMA50 && { backgroundColor: "#f59e0b20" }]}>
            <Text style={[st.toggleTxt, { color: showMA50 ? "#f59e0b" : "#6b7280" }]}>MA50</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderChart() {
    return (
      <View style={st.chartWrap}>
        {hoveredCandle && <OHLCVBar candle={hoveredCandle} aud={audRate} />}
        {loading && !candles.length ? (
          <View style={[st.chartLoader, { width }]}>
            <ActivityIndicator color="#3b82f6" />
            <Text style={st.loadingTxt}>Loading chart…</Text>
          </View>
        ) : (
          <CandlestickChart
            candles={candles}
            interval={interval}
            width={width}
            showMA20={showMA20}
            showMA50={showMA50}
            showVolume
            onCandleSelect={setHoveredCandle}
          />
        )}
      </View>
    );
  }

  function renderTabBar() {
    const tabs: { id: TradeTab; label: string; icon: string }[] = [
      { id: "trade",   label: "Trade",     icon: "trending-up" },
      { id: "book",    label: "Book",      icon: "list" },
      { id: "trades",  label: "Trades",    icon: "activity" },
      { id: "history", label: "History",   icon: "clock" },
    ];
    return (
      <View style={[st.tabBar, { borderBottomColor: colors.border }]}>
        {tabs.map(t => (
          <TouchableOpacity key={t.id} style={[st.tabBarBtn, tab === t.id && st.tabBarBtnActive]}
            onPress={() => { setTab(t.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
            <Feather name={t.icon as any} size={13} color={tab === t.id ? "#3b82f6" : "#6b7280"} />
            <Text style={[st.tabBarTxt, { color: tab === t.id ? "#3b82f6" : "#6b7280" }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  function renderTradePanel() {
    const tok = TOKENS.find(t => t.symbol === symbol)!;
    const isBuy = side === "buy";
    const btnColor = isBuy ? "#26a69a" : "#ef5350";
    const btnLabel = isBuy ? `Buy ${symbol}` : `Sell ${symbol}`;

    return (
      <View style={st.tradePanel}>
        {/* Demo mode notice */}
        <View style={st.demoBanner}>
          <Feather name="alert-circle" size={11} color="#f59e0b" />
          <Text style={st.demoBannerText}>DEMO MODE — Simulated balances, no real capital</Text>
        </View>

        {/* Success message */}
        {lastFill && (
          <View style={st.fillMsg}>
            <Feather name="check-circle" size={13} color="#26a69a" />
            <Text style={st.fillTxt}>{lastFill}</Text>
          </View>
        )}

        {/* Buy / Sell toggle */}
        <View style={st.sideRow}>
          <TouchableOpacity onPress={() => setSide("buy")} style={[st.sideBtn, isBuy && st.sideBtnBuy]}>
            <Text style={[st.sideTxt, isBuy && { color: "#26a69a" }]}>BUY</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSide("sell")} style={[st.sideBtn, !isBuy && st.sideBtnSell]}>
            <Text style={[st.sideTxt, !isBuy && { color: "#ef5350" }]}>SELL</Text>
          </TouchableOpacity>
        </View>

        {/* Order type */}
        <View style={st.typeRow}>
          {(["market","limit","stop"] as OrderType[]).map(ot => (
            <TouchableOpacity key={ot} onPress={() => setOrderType(ot)}
              style={[st.typeBtn, orderType === ot && { backgroundColor: colors.card }]}>
              <Text style={[st.typeTxt, orderType === ot && { color: colors.foreground }]}>
                {ot.charAt(0).toUpperCase() + ot.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Available balance */}
        <View style={st.availRow}>
          <Text style={st.availLabel}>Available</Text>
          <Text style={[st.availValue, { color: colors.foreground }]}>
            {isBuy ? fmtAUD(availAUD) : `${availToken.toFixed(4)} ${symbol}`}
          </Text>
        </View>

        {/* Amount input */}
        <View style={st.inputGroup}>
          <Text style={st.inputLabel}>Amount ({symbol})</Text>
          <View style={[st.inputWrap, { borderColor: amount ? "#3b82f650" : colors.border }]}>
            <View style={[st.inputTokenDot, { backgroundColor: tok.color }]}>
              <Text style={st.inputTokenTxt}>{symbol[0]}</Text>
            </View>
            <TextInput
              style={[st.input, { color: colors.foreground }]}
              placeholder="0.0000" placeholderTextColor="#4b5563"
              keyboardType="decimal-pad" value={amount}
              onChangeText={setAmount}
            />
            <Text style={st.inputSuffix}>{symbol}</Text>
          </View>
          <View style={st.quickFillRow}>
            {[25,50,75,100].map(pct => (
              <TouchableOpacity key={pct} onPress={() => handleQuickFill(pct)} style={st.quickFillBtn}>
                <Text style={st.quickFillTxt}>{pct === 100 ? "MAX" : pct + "%"}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Price input (limit / stop) */}
        {orderType !== "market" && (
          <View style={st.inputGroup}>
            <Text style={st.inputLabel}>{orderType === "limit" ? "Limit Price" : "Stop Price"} (USD)</Text>
            <View style={[st.inputWrap, { borderColor: limitPrice ? "#3b82f650" : colors.border }]}>
              <Text style={st.inputPrefix}>$</Text>
              <TextInput
                style={[st.input, { color: colors.foreground }]}
                placeholder={currentPrice.toFixed(2)} placeholderTextColor="#4b5563"
                keyboardType="decimal-pad"
                value={orderType === "limit" ? limitPrice : stopPrice}
                onChangeText={orderType === "limit" ? setLimitPrice : setStopPrice}
              />
              <TouchableOpacity onPress={() => orderType === "limit"
                ? setLimitPrice(currentPrice.toFixed(2))
                : setStopPrice(currentPrice.toFixed(2))}>
                <Text style={st.mktBtn}>MKT</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Stop Loss */}
        <View style={st.slTpRow}>
          <TouchableOpacity onPress={() => setSlEnabled(v => !v)} style={st.slTpToggle}>
            <View style={[st.checkbox, slEnabled && { backgroundColor: "#ef5350", borderColor: "#ef5350" }]}>
              {slEnabled && <Feather name="check" size={10} color="white" />}
            </View>
            <Text style={[st.slTpLabel, slEnabled && { color: "#ef5350" }]}>Stop Loss</Text>
          </TouchableOpacity>
          {slEnabled && (
            <View style={[st.inputWrapInline, { borderColor: "#ef535030" }]}>
              <Text style={[st.inputPrefix, { color: "#ef5350" }]}>$</Text>
              <TextInput
                style={[st.inputInline, { color: colors.foreground }]}
                placeholder={(currentPrice * 0.97).toFixed(2)} placeholderTextColor="#4b5563"
                keyboardType="decimal-pad" value={slPrice} onChangeText={setSlPrice}
              />
            </View>
          )}
        </View>

        {/* Take Profit */}
        <View style={st.slTpRow}>
          <TouchableOpacity onPress={() => setTpEnabled(v => !v)} style={st.slTpToggle}>
            <View style={[st.checkbox, tpEnabled && { backgroundColor: "#26a69a", borderColor: "#26a69a" }]}>
              {tpEnabled && <Feather name="check" size={10} color="white" />}
            </View>
            <Text style={[st.slTpLabel, tpEnabled && { color: "#26a69a" }]}>Take Profit</Text>
          </TouchableOpacity>
          {tpEnabled && (
            <View style={[st.inputWrapInline, { borderColor: "#26a69a30" }]}>
              <Text style={[st.inputPrefix, { color: "#26a69a" }]}>$</Text>
              <TextInput
                style={[st.inputInline, { color: colors.foreground }]}
                placeholder={(currentPrice * 1.03).toFixed(2)} placeholderTextColor="#4b5563"
                keyboardType="decimal-pad" value={tpPrice} onChangeText={setTpPrice}
              />
            </View>
          )}
        </View>

        {/* Summary */}
        {amtNum > 0 && (
          <View style={[st.summaryBox, { borderColor: colors.border }]}>
            <View style={st.summaryRow}>
              <Text style={st.summaryLabel}>Est. Total</Text>
              <Text style={[st.summaryValue, { color: colors.foreground }]}>{fmtAUD(notionalAUD)}</Text>
            </View>
            <View style={st.summaryRow}>
              <Text style={st.summaryLabel}>Trading Fee (0.75%)</Text>
              <Text style={{ color: "#f59e0b", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{fmtAUD(fee)}</Text>
            </View>
            <View style={[st.summaryRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, paddingTop: 4 }]}>
              <Text style={[st.summaryLabel, { fontFamily: "Inter_600SemiBold", color: colors.foreground }]}>Net Total</Text>
              <Text style={[st.summaryValue, { color: btnColor }]}>
                {fmtAUD(isBuy ? notionalAUD + fee : notionalAUD - fee)}
              </Text>
            </View>
          </View>
        )}

        {/* Place order button */}
        <TouchableOpacity
          style={[st.orderBtn, { backgroundColor: btnColor }, placing && { opacity: 0.6 }]}
          onPress={handlePlaceOrder} disabled={placing}>
          {placing ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <>
              <Feather name={isBuy ? "arrow-up-circle" : "arrow-down-circle"} size={16} color="white" />
              <Text style={st.orderBtnTxt}>{btnLabel}</Text>
              {orderType !== "market" && <Text style={st.orderBtnSub}> · {orderType}</Text>}
            </>
          )}
        </TouchableOpacity>

        <Text style={st.disclaimer}>
          Paper trading mode. Orders are simulated and do not execute on-chain.{"\n"}0.75% platform fee applies to all executed orders.
        </Text>
      </View>
    );
  }

  function renderOrderBook() {
    if (!orderBook) return <ActivityIndicator color="#3b82f6" style={{ margin: 32 }} />;
    const asks = [...orderBook.asks].reverse(); // highest ask at top
    return (
      <View style={st.bookWrap}>
        <View style={st.bookHeader}>
          <Text style={st.bookHeaderTxt}>Price (USD)</Text>
          <Text style={st.bookHeaderTxt}>Size ({symbol})</Text>
          <Text style={st.bookHeaderTxt}>Total</Text>
        </View>
        {asks.map((a, i) => (
          <BookRow key={`a-${i}`} {...a} side="ask" />
        ))}
        <View style={st.spreadRow}>
          <View style={[st.spreadBadge, { borderColor: colors.border }]}>
            <Text style={[st.spreadTxt, { color: colors.foreground }]}>
              Spread: {fmtP(orderBook.spread)} ({orderBook.spreadPct.toFixed(3)}%)
            </Text>
          </View>
        </View>
        {orderBook.bids.map((b, i) => (
          <BookRow key={`b-${i}`} {...b} side="bid" />
        ))}
      </View>
    );
  }

  function renderRecentTrades() {
    return (
      <View style={st.tradesWrap}>
        <View style={st.bookHeader}>
          <Text style={st.bookHeaderTxt}>Price</Text>
          <Text style={st.bookHeaderTxt}>Size</Text>
          <Text style={st.bookHeaderTxt}>Time</Text>
        </View>
        {recentTrades.map(t => (
          <View key={t.id} style={st.tradeRow}>
            <Text style={[st.tradePriceTxt, { color: t.side === "buy" ? "#26a69a" : "#ef5350" }]}>
              {fmtP(t.price)}
            </Text>
            <Text style={st.tradeSzTxt}>{fmtSz(t.size)}</Text>
            <Text style={st.tradeAgeTxt}>{fmtAge(t.age)}</Text>
          </View>
        ))}
      </View>
    );
  }

  function renderHistory() {
    if (!myOrders.length) {
      return (
        <View style={st.emptyHistory}>
          <Feather name="clock" size={28} color="#374151" />
          <Text style={st.emptyHistoryTxt}>No orders yet</Text>
          <Text style={st.emptyHistorySub}>Place your first trade to see history here</Text>
        </View>
      );
    }
    return (
      <View style={st.historyWrap}>
        {myOrders.map(o => (
          <OrderRow key={o.id} order={o} onCancel={handleCancelOrder} />
        ))}
      </View>
    );
  }

  // ── Full render ─────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={[st.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : 110, paddingTop: topPad }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled">

      <JDLHeader subtitle="Live Markets" watchdog={{ isStale: watchdog.isStale, isRecovering: watchdog.isRecovering, errorCount: watchdog.errorCount, onRetry: watchdog.forceRefresh }} />

      {/* Token selector */}
      <AnimatedEntry delay={0}>
        {renderTokenStrip()}
      </AnimatedEntry>

      {/* Pair header */}
      <AnimatedEntry delay={60}>
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          {renderPairHeader()}
          {renderStats()}
        </View>
      </AnimatedEntry>

      {/* Interval pills + MA toggles */}
      <AnimatedEntry delay={100}>
        {renderIntervalPills()}
      </AnimatedEntry>

      {/* Chart */}
      <AnimatedEntry delay={140}>
        {renderChart()}
      </AnimatedEntry>

      {/* Trade tabs + panel */}
      <AnimatedEntry delay={180}>
        <View style={[st.bottomCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {renderTabBar()}
          {tab === "trade"   && renderTradePanel()}
          {tab === "book"    && renderOrderBook()}
          {tab === "trades"  && renderRecentTrades()}
          {tab === "history" && renderHistory()}
        </View>
      </AnimatedEntry>
    </ScrollView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root: { flex: 1 },

  // Token strip
  tokenStrip: { marginTop: 8 },
  tokenCard: {
    width: 108, padding: 10, borderRadius: 12,
    backgroundColor: "#111827", borderWidth: 1, borderColor: "#1f2937",
  },
  tokenDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  tokenDotTxt: { color: "white", fontSize: 10, fontFamily: "Inter_700Bold" },
  tokenSym: { fontSize: 12, fontFamily: "Inter_700Bold" },
  tokenName: { fontSize: 9, color: "#6b7280", fontFamily: "Inter_400Regular" },
  tokenPrice: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#9ca3af" },

  // Pair header
  pairHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 10,
  },
  pairDot: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  pairDotTxt: { color: "white", fontSize: 14, fontFamily: "Inter_700Bold" },
  pairTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  pairSub: { fontSize: 10, color: "#6b7280", fontFamily: "Inter_400Regular" },
  pairPrice: { fontSize: 20, fontFamily: "Inter_700Bold" },
  pairUSD: { fontSize: 10, color: "#6b7280", fontFamily: "Inter_400Regular" },

  // Stats row
  statsRow: { gap: 16, paddingVertical: 8, paddingRight: 16 },
  statItem: { alignItems: "center" },
  statLabel: { fontSize: 9, color: "#6b7280", fontFamily: "Inter_400Regular" },
  statVal: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 1 },

  // Interval row
  intervalRow: {
    flexDirection: "row", alignItems: "center",
    marginTop: 4, paddingVertical: 8, paddingRight: 16,
  },
  ivPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: "#111827",
  },
  ivPillTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6b7280" },
  chartToggles: { flexDirection: "row", gap: 4, marginLeft: 8 },
  togglePill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: "#1f2937",
  },
  toggleTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  // OHLCV bar
  ohlcvBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 4, flexWrap: "wrap",
  },
  ohlcvItem: { fontSize: 10, fontFamily: "Inter_500Medium" },
  ohlcvLbl: { color: "#6b7280", fontFamily: "Inter_400Regular" },
  ohlcvVol: { fontSize: 10, color: "#6b7280", fontFamily: "Inter_400Regular" },

  // Chart
  chartWrap: { backgroundColor: "#0a0e1a" },
  chartLoader: { height: 313, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0a0e1a" },
  loadingTxt: { color: "#4b5563", fontSize: 12, fontFamily: "Inter_400Regular" },

  // Tab bar
  tabBar: {
    flexDirection: "row", borderBottomWidth: 1,
  },
  tabBarBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, paddingVertical: 12,
  },
  tabBarBtnActive: { borderBottomWidth: 2, borderBottomColor: "#3b82f6" },
  tabBarTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // Bottom card
  bottomCard: {
    margin: 12, borderRadius: 16, borderWidth: 1, overflow: "hidden",
  },

  // Trade panel
  tradePanel: { padding: 16, gap: 10 },
  demoBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  demoBannerText: {
    color: "#f59e0b", fontSize: 10, fontFamily: "Inter_600SemiBold", flex: 1,
  },
  fillMsg: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#26a69a15", borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: "#26a69a30",
  },
  fillTxt: { color: "#26a69a", fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  sideRow: {
    flexDirection: "row", backgroundColor: "#111827", borderRadius: 10, padding: 2,
  },
  sideBtn: {
    flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8,
  },
  sideBtnBuy: { backgroundColor: "#26a69a20", borderWidth: 1, borderColor: "#26a69a40" },
  sideBtnSell: { backgroundColor: "#ef535020", borderWidth: 1, borderColor: "#ef535040" },
  sideTxt: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#6b7280" },
  typeRow: {
    flexDirection: "row", backgroundColor: "#111827", borderRadius: 8, padding: 2,
  },
  typeBtn: { flex: 1, paddingVertical: 7, alignItems: "center", borderRadius: 6 },
  typeTxt: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#6b7280" },
  availRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  availLabel: { fontSize: 11, color: "#6b7280", fontFamily: "Inter_400Regular" },
  availValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  inputGroup: { gap: 6 },
  inputLabel: { fontSize: 11, color: "#6b7280", fontFamily: "Inter_400Regular" },
  inputWrap: {
    flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1,
    backgroundColor: "#111827", paddingHorizontal: 10, height: 44,
  },
  inputTokenDot: {
    width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 6,
  },
  inputTokenTxt: { color: "white", fontSize: 9, fontFamily: "Inter_700Bold" },
  inputPrefix: { fontSize: 13, color: "#6b7280", fontFamily: "Inter_500Medium", marginRight: 4 },
  input: {
    flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold",
    paddingVertical: 0,
  },
  inputSuffix: { fontSize: 11, color: "#6b7280", fontFamily: "Inter_500Medium" },
  mktBtn: {
    fontSize: 10, color: "#3b82f6", fontFamily: "Inter_700Bold",
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: "#3b82f620", borderRadius: 6,
  },
  quickFillRow: { flexDirection: "row", gap: 6 },
  quickFillBtn: {
    flex: 1, paddingVertical: 7, alignItems: "center",
    backgroundColor: "#1f2937", borderRadius: 7, borderWidth: 1, borderColor: "#374151",
  },
  quickFillTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#9ca3af" },
  slTpRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  slTpToggle: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: {
    width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: "#374151",
    alignItems: "center", justifyContent: "center",
  },
  slTpLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6b7280" },
  inputWrapInline: {
    flex: 1, flexDirection: "row", alignItems: "center", borderRadius: 8, borderWidth: 1,
    backgroundColor: "#111827", paddingHorizontal: 8, height: 36,
  },
  inputInline: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", paddingVertical: 0 },
  summaryBox: {
    borderRadius: 10, borderWidth: 1, padding: 12, gap: 4, backgroundColor: "#0a0e1a",
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { fontSize: 11, color: "#6b7280", fontFamily: "Inter_400Regular" },
  summaryValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  orderBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 12, paddingVertical: 15, marginTop: 4,
  },
  orderBtnTxt: { color: "white", fontSize: 15, fontFamily: "Inter_700Bold" },
  orderBtnSub: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontFamily: "Inter_400Regular" },
  disclaimer: {
    fontSize: 9, color: "#374151", fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 14, marginTop: 4,
  },

  // Order book
  bookWrap: { padding: 12, gap: 1 },
  bookHeader: {
    flexDirection: "row", paddingHorizontal: 12, paddingBottom: 8, paddingTop: 4,
  },
  bookHeaderTxt: { flex: 1, fontSize: 10, color: "#6b7280", fontFamily: "Inter_500Medium", textAlign: "right" },
  bookRow: {
    flexDirection: "row", paddingHorizontal: 12, paddingVertical: 4,
    position: "relative",
  },
  bookDepthBar: { position: "absolute", top: 0, bottom: 0, opacity: 0.5 },
  bookPrice: { flex: 1, fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "right" },
  bookSize:  { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#9ca3af", textAlign: "right" },
  bookTotal: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#6b7280", textAlign: "right" },
  spreadRow: { alignItems: "center", paddingVertical: 6 },
  spreadBadge: {
    borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4,
  },
  spreadTxt: { fontSize: 10, fontFamily: "Inter_500Medium" },

  // Recent trades
  tradesWrap: { padding: 12, gap: 1 },
  tradeRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 5 },
  tradePriceTxt: { flex: 1, fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  tradeSzTxt: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#9ca3af", textAlign: "right" },
  tradeAgeTxt: { flex: 1, fontSize: 10, fontFamily: "Inter_400Regular", color: "#6b7280", textAlign: "right" },

  // Order history
  historyWrap: { padding: 12, gap: 8 },
  orderRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10, backgroundColor: "#111827", borderRadius: 10,
  },
  orderLeft: { flex: 1.2, gap: 3 },
  orderMid: { flex: 1.5, gap: 2 },
  orderRight: { flex: 1, alignItems: "flex-end", gap: 2 },
  sideBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: "flex-start" },
  orderSymbol: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#e5e7eb" },
  orderType: { fontSize: 9, color: "#6b7280", fontFamily: "Inter_400Regular" },
  orderAmt: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#e5e7eb" },
  orderPriceText: { fontSize: 10, color: "#6b7280", fontFamily: "Inter_400Regular" },
  orderStatus: { fontSize: 10, fontFamily: "Inter_700Bold" },
  cancelBtn: {
    padding: 4, borderRadius: 4, backgroundColor: "#ef535015",
    borderWidth: 1, borderColor: "#ef535030",
  },
  orderFee: { fontSize: 9, color: "#6b7280", fontFamily: "Inter_400Regular" },
  emptyHistory: { alignItems: "center", gap: 8, padding: 40 },
  emptyHistoryTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  emptyHistorySub: { fontSize: 12, color: "#374151", fontFamily: "Inter_400Regular", textAlign: "center" },
});
