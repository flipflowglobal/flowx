import { Router, type IRouter } from "express";
import { getPriceState, getTokenPrice } from "../services/price-feed.js";
import { query } from "../services/database.js";

// ─── Candle / Trading Engine ─────────────────────────────────────────────────

interface Candle { ts: number; open: number; high: number; low: number; close: number; volume: number; }

interface MarketOrder {
  id: string; symbol: string; side: "buy" | "sell"; type: "market" | "limit" | "stop";
  amount: number; limitPrice: number | null; stopLoss: number | null; takeProfit: number | null;
  filledPrice: number | null; notional: number; fee: number; feeAUD: number;
  status: "pending" | "filled" | "cancelled"; createdAt: number; filledAt: number | null;
}
const marketOrders: MarketOrder[] = [];

// ─── DB persistence helpers ──────────────────────────────────────────────────

let _tableReady = false;
async function ensureOrdersTable() {
  if (_tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS market_orders_paper (
      id           TEXT PRIMARY KEY,
      symbol       TEXT NOT NULL,
      side         TEXT NOT NULL,
      type         TEXT NOT NULL,
      amount       DOUBLE PRECISION NOT NULL,
      limit_price  DOUBLE PRECISION,
      stop_loss    DOUBLE PRECISION,
      take_profit  DOUBLE PRECISION,
      filled_price DOUBLE PRECISION,
      notional     DOUBLE PRECISION NOT NULL,
      fee          DOUBLE PRECISION NOT NULL,
      fee_aud      DOUBLE PRECISION NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   BIGINT NOT NULL,
      filled_at    BIGINT
    )
  `);
  _tableReady = true;
}

async function dbSaveOrder(o: MarketOrder) {
  await ensureOrdersTable();
  await query(
    `INSERT INTO market_orders_paper
       (id, symbol, side, type, amount, limit_price, stop_loss, take_profit,
        filled_price, notional, fee, fee_aud, status, created_at, filled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       status = $13, filled_price = $9, filled_at = $15`,
    [o.id, o.symbol, o.side, o.type, o.amount, o.limitPrice, o.stopLoss, o.takeProfit,
     o.filledPrice, o.notional, o.fee, o.feeAUD, o.status, o.createdAt, o.filledAt]
  );
}

async function dbLoadOrders(): Promise<MarketOrder[]> {
  await ensureOrdersTable();
  const res = await query(
    `SELECT * FROM market_orders_paper ORDER BY created_at DESC LIMIT 500`
  );
  return res.rows.map((r: any) => ({
    id: r.id, symbol: r.symbol, side: r.side, type: r.type,
    amount: parseFloat(r.amount), limitPrice: r.limit_price ? parseFloat(r.limit_price) : null,
    stopLoss: r.stop_loss ? parseFloat(r.stop_loss) : null,
    takeProfit: r.take_profit ? parseFloat(r.take_profit) : null,
    filledPrice: r.filled_price ? parseFloat(r.filled_price) : null,
    notional: parseFloat(r.notional), fee: parseFloat(r.fee), feeAUD: parseFloat(r.fee_aud),
    status: r.status, createdAt: Number(r.created_at), filledAt: r.filled_at ? Number(r.filled_at) : null,
  }));
}

// Seed in-memory cache from DB on startup (non-blocking)
dbLoadOrders().then(rows => { marketOrders.push(...rows); }).catch(() => {});

const TOKEN_VOL: Record<string, number> = {
  BTC: 0.007, ETH: 0.010, BNB: 0.013, MATIC: 0.018,
  AVAX: 0.016, ARB: 0.020, SOL: 0.014, LINK: 0.012,
};

function symbolSeed(sym: string): number {
  return sym.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 17);
}

function seededRand(a: number, b: number): number {
  const s = Math.sin(a * 78721.47 + b * 31337.89 + 1234.5) * 43758.5453;
  return s - Math.floor(s);
}

function roundTo(n: number, d: number): number {
  const f = Math.pow(10, d); return Math.round(n * f) / f;
}

function priceDecimals(p: number): number {
  if (p > 10000) return 2;
  if (p > 100) return 2;
  if (p > 1) return 4;
  return 6;
}

function buildCandles(symbol: string, intervalSecs: number, limit: number): Candle[] {
  const token = getTokenPrice(symbol);
  if (!token) return [];

  const vol = TOKEN_VOL[symbol] ?? 0.014;
  const now = Date.now();
  const iMs = intervalSecs * 1000;
  const sym_n = symbolSeed(symbol);
  const volBase = token.volume24h * (intervalSecs / 86400);

  let nextOpen = token.price;
  const candles: Candle[] = [];

  for (let i = 0; i < limit; i++) {
    const ts = Math.floor(now / iMs) * iMs - i * iMs;
    const r1 = seededRand(sym_n, ts / 1e10 + 1);
    const r2 = seededRand(sym_n, ts / 1e10 + 2);
    const r3 = seededRand(sym_n, ts / 1e10 + 3);
    const r4 = seededRand(sym_n, ts / 1e10 + 4);

    const close = nextOpen;
    const chg = (r1 - 0.465) * vol * 2;       // gentle bullish drift
    const open = close / (1 + chg);
    const wk = 0.35 + r2 * 0.65;
    const high = Math.max(open, close) * (1 + wk * vol * r3);
    const low  = Math.min(open, close) * (1 - wk * vol * (1 - r3));
    const volume = volBase * (0.25 + r4 * 1.55);

    const dec = priceDecimals(close);
    candles.unshift({
      ts, volume: Math.round(volume),
      open:  roundTo(Math.max(0.000001, open),  dec),
      high:  roundTo(Math.max(0.000001, high),  dec),
      low:   roundTo(Math.max(0.000001, low),   dec),
      close: roundTo(Math.max(0.000001, close), dec),
    });
    nextOpen = open;
  }

  if (candles.length) {
    const last = candles[candles.length - 1];
    last.close = roundTo(token.price, priceDecimals(token.price));
    last.high  = Math.max(last.high, last.close);
    last.low   = Math.min(last.low,  last.close);
  }
  return candles;
}

const INTERVALS: Record<string, number> = {
  "1s": 1, "5s": 5, "30s": 30,
  "1m": 60, "5m": 300, "15m": 900,
  "1h": 3600, "4h": 14400, "1d": 86400,
};

const router: IRouter = Router();

router.get("/market/prices", (_req, res) => {
  const feed = getPriceState();
  const eth = feed.tokens["ETH"];
  const btc = feed.tokens["BTC"];

  res.json({
    eth: {
      price: eth?.price ?? 0,
      change24h: eth?.change24h ?? 0,
      volume24h: eth?.volume24h ?? 0,
      marketCap: eth?.marketCap ?? 0,
    },
    btc: {
      price: btc?.price ?? 0,
      change24h: btc?.change24h ?? 0,
      volume24h: btc?.volume24h ?? 0,
      marketCap: btc?.marketCap ?? 0,
    },
    gas: {
      slow: Math.round(feed.gasGwei * 0.8),
      standard: Math.round(feed.gasGwei),
      fast: Math.round(feed.gasGwei * 1.3),
      instant: Math.round(feed.gasGwei * 1.8),
      unit: "gwei",
    },
    defi: { totalTvl: 98_400_000_000, change24h: -0.8 },
    feedStatus: feed.status,
    lastUpdated: feed.lastFetchMs,
    timestamp: Date.now(),
  });
});

router.get("/market/all-prices", (_req, res) => {
  const feed = getPriceState();
  const tokens = Object.values(feed.tokens).map(t => ({
    symbol: t.symbol,
    price: t.price,
    change24h: t.change24h,
    volume24h: t.volume24h,
    marketCap: t.marketCap,
  }));
  res.json({ tokens, gasGwei: feed.gasGwei, status: feed.status, lastUpdated: feed.lastFetchMs });
});

router.get("/market/price/:symbol", (req, res) => {
  const token = getTokenPrice(req.params.symbol);
  if (!token) {
    res.status(404).json({ error: `Token ${req.params.symbol} not found` });
    return;
  }
  res.json(token);
});

router.get("/market/dex-pools", (_req, res) => {
  const feed = getPriceState();
  const eth = feed.tokens["ETH"]?.price ?? 1820;
  res.json({
    pools: [
      { dex: "Uniswap V3", pair: "ETH/USDC", fee: 0.05, liquidity: 245_000_000, volume24h: 89_000_000, apy: 12.4, ethPrice: eth },
      { dex: "Uniswap V3", pair: "ETH/USDT", fee: 0.30, liquidity: 182_000_000, volume24h: 62_000_000, apy: 9.8,  ethPrice: eth },
      { dex: "Curve",      pair: "USDC/USDT/DAI", fee: 0.04, liquidity: 890_000_000, volume24h: 210_000_000, apy: 3.2 },
      { dex: "Balancer",   pair: "WBTC/WETH/USDC", fee: 0.10, liquidity: 94_000_000, volume24h: 28_000_000, apy: 6.7 },
    ],
  });
});

router.get("/market/arbitrage-scan", (_req, res) => {
  const feed = getPriceState();
  const gas = feed.gasGwei;
  const opportunities = Array.from({ length: 3 }, (_, i) => ({
    id: `scan-${Date.now()}-${i}`,
    profitPct: 0.3 + Math.random() * 1.0,
    route: [["USDC","WETH","DAI"],["WETH","USDT","WBTC","WETH"],["DAI","USDC","WETH"]][i],
    dexPath: [["Uniswap","Curve"],["Balancer","SushiSwap","Uniswap"],["Curve","Uniswap"]][i],
    loanAmount: [250_000, 500_000, 150_000][i],
    netProfit: 200 + Math.random() * 400,
    confidence: 0.78 + Math.random() * 0.18,
    blocksTilExpiry: 2 + Math.floor(Math.random() * 5),
  }));
  res.json({ opportunities, scannedPairs: 847, scanTimeMs: 124, gasOracle: gas });
});

router.get("/market/gas-oracle", (_req, res) => {
  const g = getPriceState().gasGwei;
  res.json({
    slow:     { price: Math.round(g * 0.8), time: "5-10min" },
    standard: { price: Math.round(g),       time: "1-2min" },
    fast:     { price: Math.round(g * 1.3), time: "30-60s" },
    instant:  { price: Math.round(g * 1.8), time: "<15s" },
    baseFee:  Math.round(g * 0.9),
    priorityFee: Math.round(g * 0.1),
    timestamp: Date.now(),
  });
});

// ─── New Trading Endpoints ────────────────────────────────────────────────────

router.get("/market/candles", (req, res) => {
  const symbol   = ((req.query.symbol  as string) || "ETH").toUpperCase();
  const interval = (req.query.interval as string) || "5m";
  const limit    = Math.min(parseInt(req.query.limit as string || "100"), 300);

  const intervalSecs = INTERVALS[interval];
  if (!intervalSecs) { res.status(400).json({ error: `Unknown interval: ${interval}` }); return; }

  const candles = buildCandles(symbol, intervalSecs, limit);
  if (!candles.length) { res.status(404).json({ error: `Symbol not found: ${symbol}` }); return; }

  res.json({ symbol, interval, intervalSecs, candles, count: candles.length, timestamp: Date.now() });
});

router.get("/market/ticker/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const token  = getTokenPrice(symbol);
  if (!token) { res.status(404).json({ error: `Symbol not found: ${symbol}` }); return; }
  const feed   = getPriceState();
  const aud    = feed.usdToAud;
  const dec    = priceDecimals(token.price);
  const tick   = token.price > 10000 ? 1 : token.price > 100 ? 0.5 : token.price > 1 ? 0.01 : 0.0001;
  const bid    = roundTo(token.price - tick, dec);
  const ask    = roundTo(token.price + tick, dec);
  const open24 = roundTo(token.price / (1 + token.change24h / 100), dec);

  res.json({
    symbol, price: token.price, priceAUD: roundTo(token.price * aud, 4),
    bid, ask, spread: roundTo(ask - bid, dec), spreadPct: roundTo((ask - bid) / token.price * 100, 4),
    open24h: open24, high24h: roundTo(token.price * 1.025, dec), low24h: roundTo(token.price * 0.978, dec),
    change24h: roundTo(token.change24h, 4), volume24h: token.volume24h, marketCap: token.marketCap,
    usdToAud: aud, timestamp: Date.now(),
  });
});

router.get("/market/orderbook/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const token  = getTokenPrice(symbol);
  if (!token) { res.status(404).json({ error: `Symbol not found: ${symbol}` }); return; }

  const depth = Math.min(parseInt(req.query.depth as string || "16"), 30);
  const p   = token.price;
  const dec = priceDecimals(p);
  const tick = p > 10000 ? 1 : p > 1000 ? 0.5 : p > 10 ? 0.01 : p > 1 ? 0.001 : 0.0001;
  const spread = tick * 2;
  const now60  = Math.floor(Date.now() / 60000); // changes each minute

  const asks = Array.from({ length: depth }, (_, i) => {
    const pr  = roundTo(p + spread / 2 + tick * i, dec);
    const sz  = roundTo(seededRand(now60 + i, symbolSeed(symbol) + 1) * 7 + 0.3, 4);
    return { price: pr, size: sz };
  });

  const bids = Array.from({ length: depth }, (_, i) => {
    const pr  = roundTo(p - spread / 2 - tick * i, dec);
    const sz  = roundTo(seededRand(now60 + depth + i, symbolSeed(symbol) + 2) * 7 + 0.3, 4);
    return { price: pr, size: sz };
  });

  let cumAsk = 0, cumBid = 0;
  const asksT = asks.map(a => ({ ...a, total: roundTo(cumAsk += a.size, 4) }));
  const bidsT = bids.map(b => ({ ...b, total: roundTo(cumBid += b.size, 4) }));
  const maxT  = Math.max(asksT[asksT.length - 1].total, bidsT[bidsT.length - 1].total);

  res.json({
    symbol, price: p, bid: bidsT[0].price, ask: asksT[0].price,
    spread: roundTo(asksT[0].price - bidsT[0].price, dec),
    spreadPct: roundTo((asksT[0].price - bidsT[0].price) / p * 100, 4),
    asks: asksT.map(a => ({ ...a, depthPct: roundTo(a.total / maxT * 100, 1) })),
    bids: bidsT.map(b => ({ ...b, depthPct: roundTo(b.total / maxT * 100, 1) })),
    timestamp: Date.now(),
  });
});

router.get("/market/recent-trades/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const token  = getTokenPrice(symbol);
  if (!token) { res.status(404).json({ error: `Symbol not found: ${symbol}` }); return; }

  const limit = Math.min(parseInt(req.query.limit as string || "30"), 60);
  const dec   = priceDecimals(token.price);
  const tick  = token.price > 10000 ? 1 : token.price > 100 ? 0.5 : token.price > 1 ? 0.01 : 0.0001;
  const now   = Date.now();

  const trades = Array.from({ length: limit }, (_, i) => {
    const age  = i * (Math.floor(seededRand(now / 10000 + i, 99) * 8000) + 400);
    const side = seededRand(now / 10000 + i, 11) > 0.5 ? "buy" : "sell";
    const pr   = roundTo(token.price + (seededRand(now / 10000 + i, 7) - 0.5) * tick * 4, dec);
    const sz   = roundTo(seededRand(now / 10000 + i, 13) * 5 + 0.01, 4);
    return { id: `t-${now - age}`, price: pr, size: sz, side, ts: now - age, age: Math.round(age / 1000) };
  });

  res.json({ symbol, trades, timestamp: now });
});

router.post("/market/order", (req, res) => {
  const { symbol, side, type, amount, limitPrice, stopLoss, takeProfit } = req.body;
  const sym = (symbol as string || "").toUpperCase();
  const token = getTokenPrice(sym);
  if (!token) { res.status(404).json({ error: `Symbol not found: ${sym}` }); return; }

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "Invalid amount" }); return; }

  const feed = getPriceState();
  const aud  = feed.usdToAud;
  const slippage = type === "market" ? (side === "buy" ? 1.0015 : 0.9985) : 1;
  const fillPrice = type === "market" ? token.price * slippage : (limitPrice ? parseFloat(limitPrice) : token.price);
  const notional  = amt * fillPrice;
  const fee       = roundTo(notional * 0.0075, 6);
  const feeAUD    = roundTo(fee * aud, 4);

  const order: MarketOrder = {
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: sym, side, type, amount: amt,
    limitPrice: limitPrice ? parseFloat(limitPrice) : null,
    stopLoss:   stopLoss   ? parseFloat(stopLoss)   : null,
    takeProfit: takeProfit ? parseFloat(takeProfit) : null,
    filledPrice: type === "market" ? roundTo(fillPrice, priceDecimals(fillPrice)) : null,
    notional: roundTo(notional, 4), fee, feeAUD,
    status: type === "market" ? "filled" : "pending",
    createdAt: Date.now(), filledAt: type === "market" ? Date.now() : null,
  };
  marketOrders.unshift(order);
  if (marketOrders.length > 500) marketOrders.length = 500;

  dbSaveOrder(order).catch(() => {});

  res.json({
    success: true, order,
    message: type === "market"
      ? `${side === "buy" ? "Bought" : "Sold"} ${amt} ${sym} @ ${roundTo(fillPrice, priceDecimals(fillPrice))}`
      : `Limit order placed at ${limitPrice}`,
  });
});

router.get("/market/orders", (req, res) => {
  const symbol = req.query.symbol ? (req.query.symbol as string).toUpperCase() : null;
  const orders = symbol ? marketOrders.filter(o => o.symbol === symbol) : marketOrders;
  res.json({ orders: orders.slice(0, 100), count: orders.length });
});

router.delete("/market/orders/:id", (req, res) => {
  const idx = marketOrders.findIndex(o => o.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Order not found" }); return; }
  if (marketOrders[idx].status !== "pending") { res.status(400).json({ error: "Only pending orders can be cancelled" }); return; }
  marketOrders[idx].status = "cancelled";
  dbSaveOrder(marketOrders[idx]).catch(() => {});
  res.json({ success: true, order: marketOrders[idx] });
});

router.get("/market/fx-rates", (_req, res) => {
  const rate = getPriceState().usdToAud;
  res.json({
    usdToAud: rate,
    audToUsd: Math.round((1 / rate) * 10000) / 10000,
    base: "USD",
    target: "AUD",
    source: "open.er-api.com",
    timestamp: Date.now(),
  });
});

router.get("/market/strategies", (_req, res) => {
  res.json({
    strategies: [
      { id:"s-001",name:"Triangular Arbitrage",winRate:87.2,avgReturn:2.4,risk:"High",minCapital:10000,backtestPnl:48.2,totalUsers:234 },
      { id:"s-002",name:"DCA Strategy",winRate:72.3,avgReturn:1.1,risk:"Low",minCapital:500,backtestPnl:18.4,totalUsers:1820 },
      { id:"s-003",name:"Momentum Strategy",winRate:64.7,avgReturn:1.8,risk:"Medium",minCapital:2000,backtestPnl:24.8,totalUsers:641 },
      { id:"s-004",name:"Mean Reversion",winRate:66.1,avgReturn:1.3,risk:"Medium",minCapital:1000,backtestPnl:21.2,totalUsers:489 },
      { id:"s-005",name:"Grid Trading",winRate:68.5,avgReturn:0.9,risk:"Low",minCapital:2500,backtestPnl:14.8,totalUsers:893 },
      { id:"s-006",name:"Statistical Arbitrage",winRate:79.4,avgReturn:1.7,risk:"Medium",minCapital:5000,backtestPnl:32.1,totalUsers:312 },
    ],
  });
});

export default router;
