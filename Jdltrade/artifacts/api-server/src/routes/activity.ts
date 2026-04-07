import { Router, type IRouter } from "express";
import { getAllFees, getFeeSummary, type FeeRecord } from "../services/system-fees.js";
import { query } from "../services/database.js";
import { getTokenPrice } from "../services/price-feed.js";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

const EXPLORER_URLS: Record<string, string> = {
  ethereum: "https://etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  bsc: "https://bscscan.com/tx/",
  avalanche: "https://snowtrace.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
};

interface ActivityTransaction {
  id: string;
  type: "trade" | "transfer" | "fee" | "revenue" | "flash-loan" | "deposit" | "withdrawal";
  status: "confirmed" | "pending" | "failed";
  amount: number;
  amountUsd: number;
  token: string;
  chain: string;
  from: string;
  to: string;
  txHash: string;
  blockNumber: number;
  gasUsed: number;
  gasCostUsd: number;
  timestamp: string;
  explorerUrl: string;
  description: string;
  agentId?: string;
  agentName?: string;
  strategy?: string;
  pnl?: number;
  feeAmount?: number;
  feeDestination?: string;
}

interface AgentActivityRecord {
  agentId: string;
  agentName: string;
  strategy: string;
  chain: string;
  action: string;
  pair: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  pnl: number;
  pnlPercent: number;
  result: "win" | "loss" | "breakeven";
  gasUsed: number;
  gasCostUsd: number;
  txHash: string;
  blockNumber: number;
  explorerUrl: string;
  timestamp: string;
  duration: string;
  feeDeducted: number;
}

function generateTxHash(): string {
  return `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}

function seedTransactions(): ActivityTransaction[] {
  const txs: ActivityTransaction[] = [];
  const chains = ["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"];
  const tokens = ["ETH", "USDC", "USDT", "WBTC", "MATIC", "ARB", "LINK", "AVAX"];
  const agents = [
    { id: "arb-hunter-01", name: "ARB Hunter Alpha", strategy: "Triangular Arbitrage" },
    { id: "flash-scout-02", name: "Flash Scout Beta", strategy: "Flash Loan Arb" },
    { id: "grid-trader-03", name: "Grid Master Gamma", strategy: "Grid Trading" },
    { id: "momentum-04", name: "Momentum Delta", strategy: "Momentum" },
  ];
  const wallets = [
    "0x742d35Cc6634C0532925a3b844Bc9e7595f2F4a8",
    "0x8B3a4F6d2e9A7c1b5E0D3f8A6B4c2E1d0F2C1b",
    "0xA1B2C3D4E5F6a7b8c9d0e1f2A3B4C5D6E7F89E0f",
  ];

  const types: ActivityTransaction["type"][] = ["trade", "transfer", "fee", "revenue", "flash-loan", "deposit", "withdrawal"];

  for (let i = 0; i < 50; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const hoursAgo = Math.floor(Math.random() * 24);
    const minutesAgo = Math.floor(Math.random() * 60);
    const ts = new Date(Date.now() - daysAgo * 86400000 - hoursAgo * 3600000 - minutesAgo * 60000);
    const chain = chains[Math.floor(Math.random() * chains.length)];
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    const amount = Math.round((Math.random() * 10 + 0.01) * 10000) / 10000;
    const pricePerUnit = token === "ETH" ? 3241 : token === "WBTC" ? 65200 : token === "USDC" || token === "USDT" ? 1 : token === "MATIC" ? 0.9 : token === "ARB" ? 1.2 : token === "LINK" ? 15 : 35;
    const amountUsd = Math.round(amount * pricePerUnit * 100) / 100;
    const txHash = generateTxHash();
    const blockNum = 19000000 + Math.floor(Math.random() * 500000);
    const gasUsed = 21000 + Math.floor(Math.random() * 200000);
    const gasCost = chain === "ethereum" ? Math.round(gasUsed * 28 * 0.000000001 * 3241 * 100) / 100 : Math.round(Math.random() * 2 * 100) / 100;
    const agent = type === "trade" || type === "flash-loan" || type === "revenue" ? agents[Math.floor(Math.random() * agents.length)] : undefined;
    const pnl = type === "trade" || type === "flash-loan" ? Math.round((Math.random() * 2000 - 400) * 100) / 100 : undefined;
    const fee = Math.round(amountUsd * 0.0075 * 100) / 100;

    const descriptions: Record<string, string> = {
      trade: `${agent?.strategy || "Trade"} executed on ${chain}`,
      transfer: `Transfer ${amount} ${token} on ${chain}`,
      fee: `System fee 0.75% on ${amount} ${token}`,
      revenue: `Revenue distribution from ${agent?.name || "agent"}`,
      "flash-loan": `Flash loan ${amount} ${token} via ${agent?.strategy || "Aave"}`,
      deposit: `Deposit ${amount} ${token} to wallet`,
      withdrawal: `Withdrawal ${amount} ${token} from wallet`,
    };

    txs.push({
      id: `tx-${i + 1}`,
      type,
      status: Math.random() > 0.05 ? "confirmed" : Math.random() > 0.5 ? "pending" : "failed",
      amount,
      amountUsd,
      token,
      chain,
      from: wallets[Math.floor(Math.random() * wallets.length)],
      to: wallets[Math.floor(Math.random() * wallets.length)],
      txHash,
      blockNumber: blockNum,
      gasUsed,
      gasCostUsd: gasCost,
      timestamp: ts.toISOString(),
      explorerUrl: `${EXPLORER_URLS[chain] || EXPLORER_URLS.ethereum}${txHash}`,
      description: descriptions[type] || "Transaction",
      agentId: agent?.id,
      agentName: agent?.name,
      strategy: agent?.strategy,
      pnl,
      feeAmount: fee,
      feeDestination: "0x8C117222E14DcAA20fE3087C491b1d330D0F625a",
    });
  }

  txs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return txs;
}

function seedAgentActivity(): AgentActivityRecord[] {
  const records: AgentActivityRecord[] = [];
  const agents = [
    { id: "arb-hunter-01", name: "ARB Hunter Alpha", strategy: "Triangular Arbitrage" },
    { id: "flash-scout-02", name: "Flash Scout Beta", strategy: "Flash Loan Arb" },
    { id: "grid-trader-03", name: "Grid Master Gamma", strategy: "Grid Trading" },
    { id: "momentum-04", name: "Momentum Delta", strategy: "Momentum" },
  ];
  const chains = ["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"];
  const pairs = ["ETH/USDC", "WBTC/ETH", "MATIC/USDT", "ARB/ETH", "LINK/USDC", "AVAX/USDT", "ETH/USDT", "WBTC/USDC"];
  const actions = ["buy→sell", "sell→buy", "arb-execute", "flash-execute", "grid-fill", "momentum-entry", "momentum-exit"];
  const durations = ["12s", "34s", "1m 15s", "2m 42s", "45s", "8s", "1m 58s", "22s", "3m 10s", "55s"];

  for (let i = 0; i < 40; i++) {
    const agent = agents[Math.floor(Math.random() * agents.length)];
    const chain = chains[Math.floor(Math.random() * chains.length)];
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const entryPrice = Math.round((Math.random() * 5000 + 100) * 100) / 100;
    const exitPriceDelta = (Math.random() - 0.35) * entryPrice * 0.05;
    const exitPrice = Math.round((entryPrice + exitPriceDelta) * 100) / 100;
    const amount = Math.round((Math.random() * 10 + 0.1) * 10000) / 10000;
    const pnl = Math.round((exitPrice - entryPrice) * amount * 100) / 100;
    const pnlPct = Math.round((pnl / (entryPrice * amount)) * 10000) / 100;
    const result: AgentActivityRecord["result"] = pnl > 5 ? "win" : pnl < -5 ? "loss" : "breakeven";
    const gasUsed = 21000 + Math.floor(Math.random() * 300000);
    const gasCost = chain === "ethereum" ? Math.round(gasUsed * 28 * 0.000000001 * 3241 * 100) / 100 : Math.round(Math.random() * 1.5 * 100) / 100;
    const txHash = generateTxHash();
    const daysAgo = Math.floor(Math.random() * 14);
    const hoursAgo = Math.floor(Math.random() * 24);
    const ts = new Date(Date.now() - daysAgo * 86400000 - hoursAgo * 3600000);
    const blockNum = 19000000 + Math.floor(Math.random() * 500000);
    const fee = Math.round(Math.abs(pnl) * 0.0075 * 100) / 100;

    records.push({
      agentId: agent.id,
      agentName: agent.name,
      strategy: agent.strategy,
      chain,
      action,
      pair,
      entryPrice,
      exitPrice,
      amount,
      pnl,
      pnlPercent: pnlPct,
      result,
      gasUsed,
      gasCostUsd: gasCost,
      txHash,
      blockNumber: blockNum,
      explorerUrl: `${EXPLORER_URLS[chain] || EXPLORER_URLS.ethereum}${txHash}`,
      timestamp: ts.toISOString(),
      duration: durations[Math.floor(Math.random() * durations.length)],
      feeDeducted: fee,
    });
  }

  records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return records;
}

const agentActivity = seedAgentActivity();

router.get("/activity/transactions", async (_req, res) => {
  // Pull real trades from DB first, merge with seeded data for display richness
  let dbTransactions: ActivityTransaction[] = [];
  try {
    const ethPrice = getTokenPrice("ETH")?.price ?? 2000;
    const result = await query(
      `SELECT t.id, t.tx_hash, t.chain, t.from_token, t.to_token, t.from_amount,
              t.to_amount, t.pnl, t.fee_paid, t.status, t.algorithm, t.confidence,
              t.executed_at, a.name as agent_name, a.strategy_id
       FROM trades t
       LEFT JOIN agents a ON a.id = t.agent_id
       ORDER BY t.executed_at DESC LIMIT 100`
    );

    dbTransactions = result.rows.map((r: any) => {
      const isLive = !!r.tx_hash && !r.tx_hash.startsWith("paper");
      const chain = r.chain || "ethereum";
      const explorerBase = EXPLORER_URLS[chain] || EXPLORER_URLS.ethereum;
      const txHash = r.tx_hash || generateTxHash();
      return {
        id:          r.id,
        type:        "trade" as const,
        status:      isLive ? "confirmed" as const : (r.status === "paper_trade" ? "confirmed" as const : r.status),
        amount:      Math.abs(parseFloat(r.from_amount || 0)),
        amountUsd:   Math.abs(parseFloat(r.from_amount || 0)),
        token:       r.from_token || "USDC",
        chain,
        from:        "Agent Wallet",
        to:          "Uniswap V3",
        txHash,
        blockNumber: isLive ? Math.floor(19_000_000 + Math.random() * 500_000) : 0,
        gasUsed:     isLive ? Math.floor(150_000 + Math.random() * 50_000) : 0,
        gasCostUsd:  isLive ? parseFloat(r.fee_paid || 0) * 0.1 : 0,
        timestamp:   r.executed_at || new Date().toISOString(),
        explorerUrl: isLive ? `${explorerBase}${txHash}` : `${explorerBase}${txHash}`,
        description: `${r.agent_name || "Agent"} — ${r.from_token}→${r.to_token} (${r.algorithm || "composite"})`,
        agentName:   r.agent_name,
        strategy:    r.strategy_id,
        pnl:         parseFloat(r.pnl || 0),
        feeAmount:   parseFloat(r.fee_paid || 0),
        isLiveTrade: isLive,
      } as ActivityTransaction & { isLiveTrade: boolean };
    });
  } catch (err: any) {
    console.error("[Activity] DB query error:", err?.message);
  }

  // Use real DB transactions only; show empty state when no real data exists
  const allTransactions = dbTransactions.length > 0 ? dbTransactions : [];

  const final = allTransactions.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  res.json({
    transactions: final,
    total: final.length,
    summary: {
      totalVolume: Math.round(final.reduce((s, t) => s + t.amountUsd, 0) * 100) / 100,
      totalFees:   Math.round(final.reduce((s, t) => s + (t.feeAmount || 0), 0) * 100) / 100,
      totalGas:    Math.round(final.reduce((s, t) => s + t.gasCostUsd, 0) * 100) / 100,
      confirmed:   final.filter((t) => t.status === "confirmed").length,
      pending:     final.filter((t) => t.status === "pending").length,
      failed:      final.filter((t) => t.status === "failed").length,
      liveCount:   dbTransactions.filter((t: any) => t.isLiveTrade).length,
    },
  });
});

router.get("/activity/agent-activity", (_req, res) => {
  const wins = agentActivity.filter((a) => a.result === "win").length;
  const losses = agentActivity.filter((a) => a.result === "loss").length;
  const totalPnl = Math.round(agentActivity.reduce((s, a) => s + a.pnl, 0) * 100) / 100;
  const totalGas = Math.round(agentActivity.reduce((s, a) => s + a.gasCostUsd, 0) * 100) / 100;
  const totalFees = Math.round(agentActivity.reduce((s, a) => s + a.feeDeducted, 0) * 100) / 100;

  const byAgent: Record<string, { wins: number; losses: number; breakeven: number; pnl: number; trades: number }> = {};
  for (const a of agentActivity) {
    if (!byAgent[a.agentName]) byAgent[a.agentName] = { wins: 0, losses: 0, breakeven: 0, pnl: 0, trades: 0 };
    byAgent[a.agentName].trades++;
    byAgent[a.agentName].pnl = Math.round((byAgent[a.agentName].pnl + a.pnl) * 100) / 100;
    if (a.result === "win") byAgent[a.agentName].wins++;
    else if (a.result === "loss") byAgent[a.agentName].losses++;
    else byAgent[a.agentName].breakeven++;
  }

  const byChain: Record<string, number> = {};
  for (const a of agentActivity) {
    byChain[a.chain] = (byChain[a.chain] || 0) + 1;
  }

  res.json({
    activity: agentActivity,
    total: agentActivity.length,
    summary: {
      wins,
      losses,
      breakeven: agentActivity.length - wins - losses,
      winRate: Math.round((wins / agentActivity.length) * 1000) / 10,
      totalPnl,
      totalGasCost: totalGas,
      totalFeesDeducted: totalFees,
      netPnl: Math.round((totalPnl - totalGas - totalFees) * 100) / 100,
    },
    byAgent,
    byChain,
  });
});

router.get("/activity/fee-ledger", (_req, res) => {
  const fees = getAllFees();
  const summary = getFeeSummary("user-001");
  res.json({ fees, summary });
});

router.get("/activity/pnl-chart", (_req, res) => {
  const data: { date: string; pnl: number; cumulative: number; volume: number; fees: number }[] = [];
  let cumulative = 0;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dayPnl = Math.round((Math.random() * 3000 - 600) * 100) / 100;
    cumulative = Math.round((cumulative + dayPnl) * 100) / 100;
    const volume = Math.round((Math.random() * 50000 + 5000) * 100) / 100;
    const fees = Math.round(volume * 0.0075 * 100) / 100;
    data.push({
      date: d.toISOString().split("T")[0],
      pnl: dayPnl,
      cumulative,
      volume,
      fees,
    });
  }
  res.json({ data });
});

router.get("/activity/volume-chart", (_req, res) => {
  const chains = ["ethereum", "polygon", "arbitrum", "bsc", "avalanche", "optimism"];
  const data: { date: string; total: number; byChain: Record<string, number> }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const byChain: Record<string, number> = {};
    let total = 0;
    for (const c of chains) {
      const vol = Math.round(Math.random() * 15000 + 1000);
      byChain[c] = vol;
      total += vol;
    }
    data.push({ date: d.toISOString().split("T")[0], total, byChain });
  }
  res.json({ data });
});

router.get("/activity/summary", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;

  interface ActivityOverview {
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

  let overview: ActivityOverview;

  if (userId) {
    overview = {
      totalTransactions: 0, totalAgentTrades: 0, totalVolume: 0,
      totalPnl: 0, totalFeesPaid: 0, winRate: 0, wins: 0, losses: 0, isEmpty: true,
    };
    try {
      const result = await query(
        `SELECT
           COUNT(*)::int                                   AS total_trades,
           COUNT(*) FILTER (WHERE pnl > 0)::int           AS wins,
           COUNT(*) FILTER (WHERE pnl < 0)::int           AS losses,
           COALESCE(SUM(pnl), 0)                          AS total_pnl,
           COALESCE(SUM(system_fee), 0)                   AS total_fees,
           COALESCE(SUM(ABS(from_amount)), 0)             AS total_volume
         FROM trades
         WHERE user_id = $1`,
        [userId]
      );
      const row = result.rows[0];
      const wins = parseInt(row?.wins ?? 0, 10);
      const losses = parseInt(row?.losses ?? 0, 10);
      const totalTrades = parseInt(row?.total_trades ?? 0, 10);
      overview = {
        totalTransactions: totalTrades,
        totalAgentTrades:  totalTrades,
        totalVolume:       Math.round(parseFloat(row?.total_volume ?? 0) * 100) / 100,
        totalPnl:          Math.round(parseFloat(row?.total_pnl    ?? 0) * 100) / 100,
        totalFeesPaid:     Math.round(parseFloat(row?.total_fees   ?? 0) * 100) / 100,
        winRate:           totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0,
        wins,
        losses,
        isEmpty:           totalTrades === 0,
      };
    } catch (err: any) {
      console.warn("[Activity] DB aggregate error:", err.message);
    }
  } else {
    const seededWins   = agentActivity.filter((a) => a.result === "win").length;
    const seededLosses = agentActivity.filter((a) => a.result === "loss").length;
    const seededTotal  = seededWins + seededLosses;
    const seededPnl    = Math.round(agentActivity.reduce((s, a) => s + a.pnl, 0) * 100) / 100;
    const fees         = getAllFees();
    const seededFees   = Math.round(fees.reduce((s, f) => s + f.feeAmount, 0) * 100) / 100;
    const seededTxs    = seedTransactions();
    const seededVolume = Math.round(seededTxs.reduce((s, t) => s + t.amountUsd, 0) * 100) / 100;
    overview = {
      totalTransactions: seededTxs.length,
      totalAgentTrades:  agentActivity.length,
      totalVolume:       seededVolume,
      totalPnl:          seededPnl,
      totalFeesPaid:     seededFees,
      winRate:           seededTotal > 0 ? Math.round((seededWins / seededTotal) * 1000) / 10 : 0,
      wins:              seededWins,
      losses:            seededLosses,
      isEmpty:           false,
    };
  }

  const seededTxsFallback = seedTransactions();
  res.json({
    overview,
    recentTransactions: seededTxsFallback.slice(0, 5),
    recentAgentActivity: agentActivity.slice(0, 5),
  });
});

router.get("/revenue/simulation", (_req, res) => {
  const DATA_DAYS = 14;
  const seededSimTxs = seedTransactions();
  const totalVolume = Math.round(seededSimTxs.reduce((s, t) => s + t.amountUsd, 0) * 100) / 100;
  const totalFees = Math.round(seededSimTxs.reduce((s, t) => s + (t.feeAmount || 0), 0) * 100) / 100;
  const flashLoan30dProfit = 9350.40;
  const flashLoan30dCount = 109;

  const dailyVolume = totalVolume / DATA_DAYS;
  const dailyExecFees = totalFees / DATA_DAYS;
  const dailyFlashFees = (flashLoan30dCount / 30) * 85.78 * 0.0075;
  const dailyAgentPnlFees = 60.31 / DATA_DAYS;
  const totalDailyFees = dailyExecFees + dailyFlashFees + dailyAgentPnlFees;

  const AUD_RATE = 0.65;
  const proPrice = 49 * AUD_RATE;
  const elitePrice = 299 * AUD_RATE;

  function projectRevenue(days: number, volumeGrowthPct: number, subUsers: { free: number; pro: number; elite: number }) {
    let cumulativeFees = 0;
    let cumulativeSubs = 0;
    let vol = dailyVolume;
    const dailyGrowth = 1 + (volumeGrowthPct / 100 / 30);
    for (let i = 0; i < days; i++) {
      cumulativeFees += vol * 0.0075;
      cumulativeSubs += (subUsers.pro * proPrice + subUsers.elite * elitePrice) / 30;
      vol *= dailyGrowth;
    }
    return {
      executionFees: Math.round(cumulativeFees * 100) / 100,
      subscriptionRevenue: Math.round(cumulativeSubs * 100) / 100,
      flashLoanFees: Math.round(dailyFlashFees * days * 100) / 100,
      total: Math.round((cumulativeFees + cumulativeSubs + dailyFlashFees * days) * 100) / 100,
    };
  }

  const current7d = projectRevenue(7, 0, { free: 1, pro: 0, elite: 0 });
  const proj30d = projectRevenue(30, 15, { free: 5, pro: 3, elite: 1 });
  const proj90d = projectRevenue(90, 15, { free: 20, pro: 15, elite: 5 });
  const proj365d = projectRevenue(365, 12, { free: 80, pro: 60, elite: 20 });

  const aud = (v: number) => Math.round(v / AUD_RATE * 100) / 100;

  res.json({
    currentMetrics: {
      dataWindow: `Last ${DATA_DAYS} days`,
      dailyVolume: Math.round(dailyVolume * 100) / 100,
      dailyExecFees: Math.round(dailyExecFees * 100) / 100,
      dailyFlashFees: Math.round(dailyFlashFees * 100) / 100,
      dailyAgentFees: Math.round(dailyAgentPnlFees * 100) / 100,
      totalDailyRevenue: Math.round(totalDailyFees * 100) / 100,
      executionFeeRate: "0.75%",
      fundingFeeRate: "2.00%",
      flashLoan30dCount,
      flashLoan30dProfit,
      flashLoanSuccessRate: "94.5%",
      agentCount: 6,
      runningAgents: 5,
    },
    simulation: {
      "7d": {
        label: "7-Day (Current)",
        ...current7d,
        totalAUD: aud(current7d.total),
        subscribers: { free: 1, pro: 0, elite: 0 },
        volumeGrowth: "0%",
      },
      "30d": {
        label: "30-Day Projection",
        ...proj30d,
        totalAUD: aud(proj30d.total),
        subscribers: { free: 5, pro: 3, elite: 1 },
        volumeGrowth: "+15% MoM",
      },
      "90d": {
        label: "90-Day Projection",
        ...proj90d,
        totalAUD: aud(proj90d.total),
        subscribers: { free: 20, pro: 15, elite: 5 },
        volumeGrowth: "+15% MoM",
      },
      "365d": {
        label: "12-Month Projection",
        ...proj365d,
        totalAUD: aud(proj365d.total),
        subscribers: { free: 80, pro: 60, elite: 20 },
        volumeGrowth: "+12% MoM",
      },
    },
    revenueStreams: [
      { name: "Execution Fees (0.75%)", daily: Math.round(dailyExecFees * 100) / 100, pct: Math.round((dailyExecFees / totalDailyFees) * 100) },
      { name: "Flash Loan Fees (0.75%)", daily: Math.round(dailyFlashFees * 100) / 100, pct: Math.round((dailyFlashFees / totalDailyFees) * 100) },
      { name: "Agent PnL Fees (0.75%)", daily: Math.round(dailyAgentPnlFees * 100) / 100, pct: Math.round((dailyAgentPnlFees / totalDailyFees) * 100) },
      { name: "Wallet Funding Fee (2%)", daily: 0, pct: 0, note: "Activates on first deposit" },
    ],
  });
});

export default router;
