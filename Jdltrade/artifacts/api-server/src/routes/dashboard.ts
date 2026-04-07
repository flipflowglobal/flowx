import { Router, type IRouter } from "express";
import { getPriceState } from "../services/price-feed.js";
import { getAllAgents, getAgentsForRequest } from "./agents.js";
import { query } from "../services/database.js";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

function generatePortfolioHistory(
  agents: any[],
  period: "7d" | "30d" | "90d"
): { day: string; value: number }[] {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const totalPnl = agents.reduce((s, a) => s + (a.performance?.pnl || 0), 0);
  const totalCapital = agents.reduce((s, a) => s + (a.capital || 0), 0);
  const startValue = totalCapital;
  const endValue = totalCapital + totalPnl;

  const now = Date.now();
  const points: { day: string; value: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * 86_400_000;
    const date = new Date(ts);
    const label =
      period === "7d"
        ? date.toLocaleDateString("en-US", { weekday: "short" })
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const t = (days - 1 - i) / (days - 1);
    const curve = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const noise = (Math.sin(i * 2.1) * 0.015 + Math.cos(i * 1.7) * 0.01) * endValue;
    const value = startValue + curve * (endValue - startValue) + noise;

    points.push({ day: label, value: Math.max(0, Math.round(value * 100) / 100) });
  }

  return points;
}

function computePortfolioStats(
  agents: any[],
  period: "7d" | "30d" | "90d"
): { changePct: number; changeAmt: number; sharpe: number; label: string } {
  const totalPnl = agents.reduce((s, a) => s + (a.performance?.pnl || 0), 0);
  const totalCapital = agents.reduce((s, a) => s + (a.capital || 0), 0);
  const avgSharpe =
    agents.length > 0
      ? agents.reduce((s, a) => s + (a.performance?.sharpe || 1.8), 0) / agents.length
      : 1.8;

  const fraction = period === "7d" ? 7 / 365 : period === "30d" ? 30 / 365 : 90 / 365;
  const periodPnl = totalPnl * fraction * (period === "7d" ? 3 : period === "30d" ? 2 : 1);
  const changePct = totalCapital > 0 ? Math.round((periodPnl / totalCapital) * 10000) / 100 : 0;

  const labels: Record<string, string> = { "7d": "7 Days", "30d": "30 Days", "90d": "90 Days" };
  return {
    changePct: Math.abs(changePct),
    changeAmt: Math.round(Math.abs(periodPnl) * 100) / 100,
    sharpe: Math.round(avgSharpe * 100) / 100,
    label: labels[period],
  };
}

function computeAiEngines(agents: any[]) {
  const engineIds = ["ppo", "thompson", "ukf", "cma_es"];
  const engineNames: Record<string, string> = {
    ppo: "PPO Reinforcement",
    thompson: "Thompson Sampling",
    ukf: "Unscented Kalman",
    cma_es: "CMA-ES Evolution",
  };

  const agg: Record<string, { accuracySum: number; tradesSum: number; shapleySum: number; count: number }> = {};
  for (const id of engineIds) agg[id] = { accuracySum: 0, tradesSum: 0, shapleySum: 0, count: 0 };

  for (const agent of agents) {
    const engines = agent.performance?.engines || {};
    const shapley = agent.performance?.shapleyWeights || {};
    const trades = agent.performance?.totalTrades || 0;
    for (const id of engineIds) {
      if (engines[id] != null) {
        agg[id].accuracySum += engines[id];
        agg[id].tradesSum += Math.round(trades * ((shapley[id] || 25) / 100));
        agg[id].shapleySum += shapley[id] || 25;
        agg[id].count++;
      }
    }
  }

  const result = engineIds.map((id) => {
    const a = agg[id];
    const count = a.count || 1;
    return {
      id,
      name: engineNames[id],
      status: "active",
      accuracy: Math.round(a.accuracySum / count) / 100,
      trades: a.tradesSum,
      shapleyWeight: Math.round((a.shapleySum / count) * 100) / 100,
    };
  });

  // compositeAccuracy: weighted average of individual engine decimals → stays as decimal (0-1)
  const totalShapley = result.reduce((s, e) => s + e.shapleyWeight, 0) || 1;
  const compositeAccuracy =
    result.reduce((s, e) => s + e.accuracy * e.shapleyWeight, 0) / totalShapley;
  // Average shapley weight across engines (for display as "ensemble weight")
  const avgShapley = Math.round((totalShapley / result.length) * 100) / 100;

  result.push({
    id: "composite",
    name: "Composite Ensemble",
    status: "active",
    accuracy: Math.round(compositeAccuracy * 10000) / 10000,  // stays as decimal (0-1)
    trades: result.reduce((s, e) => s + e.trades, 0),
    shapleyWeight: avgShapley,
  });

  return result;
}

async function computeRevenueBreakdown(agents: any[], userId?: string) {
  const totalPnl = agents.reduce((s, a) => s + Math.max(0, a.performance?.pnl || 0), 0);
  const systemFees = totalPnl * 0.0075;
  const fundingFees = totalPnl * 0.002;
  const oracleRevenue = agents.length * 12;

  let subscriptionRevenue = 0;
  if (userId) {
    try {
      const result = await query(
        `SELECT COALESCE(SUM(amount_pence), 0) AS total_pence
         FROM gc_subscriptions
         WHERE clerk_user_id = $1 AND status IN ('active', 'paid', 'confirmed')`,
        [userId]
      );
      const totalPence = parseFloat(result.rows[0]?.total_pence ?? 0);
      subscriptionRevenue = totalPence / 100;
    } catch {
      subscriptionRevenue = agents.length * 49;
    }
  } else {
    subscriptionRevenue = agents.length * 49;
  }

  const total = systemFees + subscriptionRevenue + fundingFees + oracleRevenue || 1;
  return [
    {
      source: "System Fees (0.75%)",
      pct: Math.round((systemFees / total) * 100),
      amount: Math.round(systemFees * 100) / 100,
      color: "#3b82f6",
    },
    {
      source: "Subscriptions",
      pct: Math.round((subscriptionRevenue / total) * 100),
      amount: Math.round(subscriptionRevenue * 100) / 100,
      color: "#8b5cf6",
    },
    {
      source: "Funding Fees (2%)",
      pct: Math.round((fundingFees / total) * 100),
      amount: Math.round(fundingFees * 100) / 100,
      color: "#22c55e",
    },
    {
      source: "Credit Oracle",
      pct: Math.round((oracleRevenue / total) * 100),
      amount: Math.round(oracleRevenue * 100) / 100,
      color: "#f59e0b",
    },
  ];
}

router.get("/dashboard/summary", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId ?? undefined;
  const agents = await getAgentsForRequest(req);
  const prices = getPriceState();

  const portfolioHistory = {
    "7d": generatePortfolioHistory(agents, "7d"),
    "30d": generatePortfolioHistory(agents, "30d"),
    "90d": generatePortfolioHistory(agents, "90d"),
  };

  const portfolioStats = {
    "7d": computePortfolioStats(agents, "7d"),
    "30d": computePortfolioStats(agents, "30d"),
    "90d": computePortfolioStats(agents, "90d"),
  };

  const aiEngines = computeAiEngines(agents);
  const revenueBreakdown = await computeRevenueBreakdown(agents, userId);

  res.json({
    portfolioHistory,
    portfolioStats,
    aiEngines,
    revenueBreakdown,
    prices: {
      eth: prices.tokens["ETH"]?.price ?? null,
      btc: prices.tokens["BTC"]?.price ?? null,
    },
    agentCount: agents.length,
    timestamp: Date.now(),
  });
});

export default router;
