import React, { useRef, useState, useMemo, useCallback } from "react";
import { PanResponder, View, Text, StyleSheet } from "react-native";
import Svg, { G, Rect, Line, Path, Text as SvgText, Defs, LinearGradient, Stop } from "react-native-svg";
import type { Candle } from "@/lib/api";

const CHART_H  = 230;
const VOL_H    = 55;
const X_AXIS_H = 28;
const Y_AXIS_W = 62;
const TOTAL_H  = CHART_H + VOL_H + X_AXIS_H;

const C_UP   = "#26a69a";
const C_DOWN = "#ef5350";
const C_MA20 = "#3b82f6";
const C_MA50 = "#f59e0b";
const GRID   = "rgba(255,255,255,0.05)";
const MUTED  = "#4b5563";
const LABEL  = "#9ca3af";

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 100)   return p.toFixed(2);
  if (p >= 1)     return p.toFixed(4);
  return p.toFixed(6);
}

function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

function fmtTime(ts: number, interval: string): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  if (["1s", "5s", "30s"].includes(interval)) return `${hh}:${mm}:${ss}`;
  if (["1m", "5m", "15m"].includes(interval)) return `${hh}:${mm}`;
  if (["1h", "4h"].includes(interval)) {
    const day = d.getDate().toString().padStart(2, "0");
    return `${day} ${hh}:${mm}`;
  }
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return `${mon} ${d.getDate()}`;
}

function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    return sum / period;
  });
}

interface Props {
  candles: Candle[];
  interval: string;
  width: number;
  showMA20?: boolean;
  showMA50?: boolean;
  showVolume?: boolean;
  onCandleSelect?: (c: Candle | null) => void;
}

export default function CandlestickChart({
  candles, interval, width,
  showMA20 = true, showMA50 = true, showVolume = true,
  onCandleSelect,
}: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const contentW = width - Y_AXIS_W;

  const { minP, maxP, candleSpacing, bodyW } = useMemo(() => {
    if (!candles.length) return { minP: 0, maxP: 1, candleSpacing: 8, bodyW: 5 };
    const lows  = candles.map(c => c.low);
    const highs = candles.map(c => c.high);
    const rawRange = Math.max(...highs) - Math.min(...lows);
    const pad = rawRange > 0 ? rawRange * 0.06 : Math.max(...highs) * 0.01;
    const sp  = contentW / candles.length;
    return {
      minP: Math.min(...lows)  - pad,
      maxP: Math.max(...highs) + pad,
      candleSpacing: sp,
      bodyW: Math.max(1, sp * 0.65),
    };
  }, [candles, contentW]);

  const maxVol = useMemo(() =>
    candles.reduce((m, c) => Math.max(m, c.volume), 1), [candles]);

  const closes  = useMemo(() => candles.map(c => c.close), [candles]);
  const ma20pts = useMemo(() => showMA20 ? calcMA(closes, 20) : [], [closes, showMA20]);
  const ma50pts = useMemo(() => showMA50 ? calcMA(closes, 50) : [], [closes, showMA50]);

  const yScale = useCallback((price: number) => {
    return CHART_H * (1 - (price - minP) / (maxP - minP));
  }, [minP, maxP]);

  const xCenter = useCallback((i: number) => {
    return i * candleSpacing + candleSpacing / 2;
  }, [candleSpacing]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => {
        const idx = Math.min(candles.length - 1, Math.max(0, Math.floor(e.nativeEvent.locationX / candleSpacing)));
        setHoveredIdx(idx);
        onCandleSelect?.(candles[idx] ?? null);
      },
      onPanResponderMove: (e) => {
        const idx = Math.min(candles.length - 1, Math.max(0, Math.floor(e.nativeEvent.locationX / candleSpacing)));
        setHoveredIdx(idx);
        onCandleSelect?.(candles[idx] ?? null);
      },
      onPanResponderRelease: () => {
        setHoveredIdx(null);
        onCandleSelect?.(null);
      },
      onPanResponderTerminate: () => {
        setHoveredIdx(null);
        onCandleSelect?.(null);
      },
    })
  ).current;

  if (!candles.length) {
    return (
      <View style={[styles.placeholder, { width, height: TOTAL_H }]}>
        <Text style={styles.placeholderTxt}>Loading chart…</Text>
      </View>
    );
  }

  // Grid levels
  const gridLevels = Array.from({ length: 5 }, (_, i) => {
    const pct = i / 4;
    return { price: minP + pct * (maxP - minP), y: yScale(minP + pct * (maxP - minP)) };
  });

  // Time label indices (show 5 evenly spaced)
  const timeLabelIdxs: number[] = [];
  if (candles.length > 1) {
    const step = Math.max(1, Math.floor(candles.length / 5));
    for (let i = step; i < candles.length - 1; i += step) timeLabelIdxs.push(i);
    timeLabelIdxs.push(candles.length - 1);
  }

  // Build MA paths
  function buildPath(pts: (number | null)[]): string {
    let d = "";
    pts.forEach((v, i) => {
      if (v == null) return;
      const x = xCenter(i);
      const y = yScale(v);
      d += d === "" ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return d;
  }

  const hovered = hoveredIdx != null ? candles[hoveredIdx] : null;
  const currentPrice = candles[candles.length - 1]?.close ?? 0;

  return (
    <View style={{ width, height: TOTAL_H }}>
      <Svg width={width} height={TOTAL_H}>
        <Defs>
          <LinearGradient id="volUp" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C_UP}   stopOpacity="0.5" />
            <Stop offset="1" stopColor={C_UP}   stopOpacity="0.1" />
          </LinearGradient>
          <LinearGradient id="volDn" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C_DOWN} stopOpacity="0.5" />
            <Stop offset="1" stopColor={C_DOWN} stopOpacity="0.1" />
          </LinearGradient>
        </Defs>

        {/* ── Price grid lines ─────────────────────────────────────── */}
        {gridLevels.map((g, i) => (
          <G key={`grid-${i}`}>
            <Line x1={0} y1={g.y} x2={contentW} y2={g.y}
              stroke={GRID} strokeWidth={1} />
            <SvgText x={contentW + 4} y={g.y + 3.5}
              fill={LABEL} fontSize={9} fontFamily="monospace">
              {fmtPrice(g.price)}
            </SvgText>
          </G>
        ))}

        {/* ── Current price line ───────────────────────────────────── */}
        {(() => {
          const cy = yScale(currentPrice);
          const isUp = candles[candles.length - 1]?.close >= (candles[candles.length - 2]?.close ?? 0);
          const clr = isUp ? C_UP : C_DOWN;
          return (
            <G>
              <Line x1={0} y1={cy} x2={contentW} y2={cy}
                stroke={clr} strokeWidth={0.5} strokeDasharray="4,4" opacity={0.7} />
              <Rect x={contentW} y={cy - 8} width={Y_AXIS_W} height={16} fill={clr} rx={3} />
              <SvgText x={contentW + 3} y={cy + 4} fill="white" fontSize={9} fontFamily="monospace">
                {fmtPrice(currentPrice)}
              </SvgText>
            </G>
          );
        })()}

        {/* ── Candlesticks ─────────────────────────────────────────── */}
        {candles.map((c, i) => {
          const isUp   = c.close >= c.open;
          const clr    = isUp ? C_UP : C_DOWN;
          const cx     = xCenter(i);
          const bodyX  = cx - bodyW / 2;
          const bodyY  = yScale(Math.max(c.open, c.close));
          const bodyH  = Math.max(1, Math.abs(yScale(c.open) - yScale(c.close)));
          const wickY1 = yScale(c.high);
          const wickY2 = yScale(c.low);
          return (
            <G key={`c-${i}`}>
              <Line x1={cx} y1={wickY1} x2={cx} y2={wickY2}
                stroke={clr} strokeWidth={1} />
              <Rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} fill={clr} />
            </G>
          );
        })}

        {/* ── MA20 line ────────────────────────────────────────────── */}
        {showMA20 && buildPath(ma20pts) && (
          <Path d={buildPath(ma20pts)} stroke={C_MA20} strokeWidth={1.2}
            fill="none" opacity={0.9} />
        )}

        {/* ── MA50 line ────────────────────────────────────────────── */}
        {showMA50 && buildPath(ma50pts) && (
          <Path d={buildPath(ma50pts)} stroke={C_MA50} strokeWidth={1.2}
            fill="none" opacity={0.9} />
        )}

        {/* ── Crosshair ────────────────────────────────────────────── */}
        {hovered && hoveredIdx != null && (() => {
          const cx = xCenter(hoveredIdx);
          const cy = yScale(hovered.close);
          return (
            <G>
              <Line x1={cx} y1={0} x2={cx} y2={CHART_H}
                stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="3,3" />
              <Line x1={0} y1={cy} x2={contentW} y2={cy}
                stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="3,3" />
              <Rect x={contentW} y={cy - 8} width={Y_AXIS_W} height={16}
                fill="#6366f1" rx={3} />
              <SvgText x={contentW + 3} y={cy + 4} fill="white"
                fontSize={9} fontFamily="monospace">
                {fmtPrice(hovered.close)}
              </SvgText>
            </G>
          );
        })()}

        {/* ── Volume bars ──────────────────────────────────────────── */}
        {showVolume && candles.map((c, i) => {
          const isUp  = c.close >= c.open;
          const barH  = (c.volume / maxVol) * VOL_H;
          const bx    = xCenter(i) - bodyW / 2;
          const by    = CHART_H + VOL_H - barH;
          return (
            <Rect key={`v-${i}`}
              x={bx} y={by} width={bodyW} height={barH}
              fill={isUp ? "url(#volUp)" : "url(#volDn)"}
            />
          );
        })}

        {/* ── Volume max label ─────────────────────────────────────── */}
        {showVolume && (
          <SvgText x={contentW + 4} y={CHART_H + 10}
            fill={MUTED} fontSize={8} fontFamily="monospace">
            {fmtVol(maxVol)}
          </SvgText>
        )}

        {/* ── Separator line (chart / volume) ─────────────────────── */}
        <Line x1={0} y1={CHART_H} x2={contentW} y2={CHART_H}
          stroke={GRID} strokeWidth={1} />

        {/* ── Time axis labels ─────────────────────────────────────── */}
        {timeLabelIdxs.map(i => (
          <SvgText key={`t-${i}`}
            x={xCenter(i)} y={CHART_H + VOL_H + 18}
            fill={LABEL} fontSize={9} fontFamily="monospace"
            textAnchor="middle">
            {fmtTime(candles[i].ts, interval)}
          </SvgText>
        ))}

        {/* ── Right axis border ────────────────────────────────────── */}
        <Line x1={contentW} y1={0} x2={contentW} y2={CHART_H + VOL_H}
          stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      </Svg>

      {/* ── Touch overlay ────────────────────────────────────────────── */}
      <View
        style={{ position: "absolute", top: 0, left: 0, width: contentW, height: CHART_H + VOL_H }}
        {...panResponder.panHandlers}
      />

      {/* ── MA legend ────────────────────────────────────────────────── */}
      {(showMA20 || showMA50) && (
        <View style={styles.maLegend}>
          {showMA20 && <Text style={[styles.maLabel, { color: C_MA20 }]}>MA20</Text>}
          {showMA50 && <Text style={[styles.maLabel, { color: C_MA50 }]}>MA50</Text>}
        </View>
      )}
    </View>
  );
}

export const CHART_TOTAL_H = TOTAL_H;

const styles = StyleSheet.create({
  placeholder: {
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#0a0e1a",
  },
  placeholderTxt: { color: "#4b5563", fontSize: 13, fontFamily: "Inter_400Regular" },
  maLegend: {
    position: "absolute", top: 6, left: 8,
    flexDirection: "row", gap: 12,
  },
  maLabel: {
    fontSize: 10, fontFamily: "Inter_500Medium",
    paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 4,
  },
});
