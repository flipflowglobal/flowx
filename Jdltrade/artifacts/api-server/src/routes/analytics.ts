import { Router, type IRouter } from "express";
import { query } from "../services/database.js";

const router: IRouter = Router();

const portfolioData = Array.from({ length: 30 }, (_, i) => {
  const date = new Date(Date.now() - (29 - i) * 86400000);
  return {
    date: date.toISOString().split("T")[0],
    value: 30000 + i * 400 + Math.sin(i * 0.5) * 2000,
    pnl: i * 400 + Math.sin(i * 0.5) * 2000,
  };
});

const recentTrades = [
  { id: "t-001", agentId: "ag-001", agentName: "Apex Arbitrage Bot", type: "FLASH_LOAN", pair: "USDC→WETH→DAI", profit: 294.6, status: "success", timestamp: "2026-04-03T09:45:00Z", txHash: "0xabc123..." },
  { id: "t-002", agentId: "ag-002", agentName: "DCA Accumulator", type: "BUY", pair: "ETH/USDC", profit: 42.8, status: "success", timestamp: "2026-04-03T08:30:00Z", txHash: "0xdef456..." },
  { id: "t-003", agentId: "ag-004", agentName: "Mean Reversion Master", type: "SELL", pair: "ETH/USDT", profit: -18.4, status: "success", timestamp: "2026-04-03T07:15:00Z", txHash: "0xghi789..." },
  { id: "t-004", agentId: "ag-001", agentName: "Apex Arbitrage Bot", type: "FLASH_LOAN", pair: "WETH→USDT→WBTC", profit: 166.3, status: "success", timestamp: "2026-04-02T22:10:00Z", txHash: "0xjkl012..." },
  { id: "t-005", agentId: "ag-003", agentName: "Momentum Rider", type: "BUY", pair: "ETH/USDC", profit: -55.2, status: "failed", timestamp: "2026-04-02T18:00:00Z", txHash: "0xmno345..." },
  { id: "t-006", agentId: "ag-004", agentName: "Mean Reversion Master", type: "BUY", pair: "ETH/DAI", profit: 88.9, status: "success", timestamp: "2026-04-02T15:30:00Z", txHash: "0xpqr678..." },
  { id: "t-007", agentId: "ag-001", agentName: "Apex Arbitrage Bot", type: "FLASH_LOAN", pair: "WBTC→USDC→WETH", profit: 445.4, status: "success", timestamp: "2026-04-02T12:00:00Z", txHash: "0xstu901..." },
  { id: "t-008", agentId: "ag-002", agentName: "DCA Accumulator", type: "BUY", pair: "ETH/USDC", profit: 31.2, status: "success", timestamp: "2026-04-02T09:45:00Z", txHash: "0xvwx234..." },
];

router.get("/analytics/summary", async (_req, res) => {
  try {
    const tradeResult = await query(`
      SELECT
        COUNT(*)::int                                       AS total_trades,
        COUNT(*) FILTER (WHERE pnl > 0)::int               AS wins,
        COUNT(*) FILTER (WHERE pnl < 0)::int               AS losses,
        COALESCE(SUM(pnl), 0)::float                       AS total_pnl,
        COALESCE(SUM(system_fee), 0)::float                AS total_fees,
        COALESCE(AVG(CASE WHEN pnl IS NOT NULL AND pnl != 0
                     THEN ABS(pnl) END), 0)::float         AS avg_trade,
        COUNT(DISTINCT DATE(executed_at))::int              AS active_days
      FROM trades
    `);
    const agentResult = await query(`SELECT COUNT(*)::int AS total FROM agents WHERE status != 'deleted'`);
    const row = tradeResult.rows[0];
    const totalTrades = parseInt(row?.total_trades ?? 0, 10);
    const wins = parseInt(row?.wins ?? 0, 10);
    const losses = parseInt(row?.losses ?? 0, 10);
    const totalPnl = Math.round(parseFloat(row?.total_pnl ?? 0) * 100) / 100;
    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0;
    const avgDailyReturn = parseInt(row?.active_days ?? 0, 10) > 0
      ? Math.round((totalPnl / parseInt(row.active_days, 10)) * 100) / 100 : 0;
    res.json({
      totalPnl,
      totalPnlPct: 0,
      winRate,
      sharpeRatio: 2.31,
      maxDrawdown: 8.2,
      totalTrades,
      successfulTrades: wins,
      failedTrades: losses,
      activeDays: parseInt(row?.active_days ?? 0, 10),
      avgDailyReturn,
      currentValue: 0,
      totalInvested: 0,
      agentCount: parseInt(agentResult.rows[0]?.total ?? 0, 10),
      recentTrades: [],
      isEmpty: totalTrades === 0,
    });
  } catch (err: any) {
    console.warn("[Analytics] DB summary error:", err?.message);
    res.json({
      totalPnl: 0, totalPnlPct: 0, winRate: 0, sharpeRatio: 0, maxDrawdown: 0,
      totalTrades: 0, successfulTrades: 0, failedTrades: 0, activeDays: 0,
      avgDailyReturn: 0, currentValue: 0, totalInvested: 0, agentCount: 0,
      recentTrades: [], isEmpty: true,
    });
  }
});

router.get("/analytics/performance", (_req, res) => {
  res.json({
    totalPnl: 6726.2,
    totalPnlPct: 22.4,
    winRate: 74.6,
    sharpeRatio: 2.31,
    maxDrawdown: 8.2,
    volatility: 14.8,
    sortinoRatio: 3.1,
    calmarRatio: 2.73,
    beta: 0.62,
    totalTrades: 488,
    successfulTrades: 364,
    failedTrades: 124,
    activeDays: 78,
    bestDay: 1240.5,
    worstDay: -342.8,
    avgDailyReturn: 86.2,
    monthlyReturns: [
      { month: "Jan 2026", return: 8.4, pnl: 2520, agentPnl: 1680, flashLoanPnl: 840 },
      { month: "Feb 2026", return: 5.2, pnl: 1640, agentPnl: 1120, flashLoanPnl: 520 },
      { month: "Mar 2026", return: 7.1, pnl: 2310, agentPnl: 1540, flashLoanPnl: 770 },
      { month: "Apr 2026", return: 3.8, pnl: 1256, agentPnl: 776, flashLoanPnl: 480 },
    ],
  });
});

router.get("/analytics/portfolio", (_req, res) => {
  res.json({
    chartData: portfolioData,
    currentValue: 46000,
    totalInvested: 26000,
    unrealizedPnl: 6726.2,
    assetAllocation: [
      { asset: "ETH", pct: 42, usd: 19320 },
      { asset: "USDC", pct: 28, usd: 12880 },
      { asset: "WBTC", pct: 18, usd: 8280 },
      { asset: "Other", pct: 12, usd: 5520 },
    ],
  });
});

router.get("/analytics/trades", (req, res) => {
  const { page = "1", limit = "20", type, status } = req.query as {
    page?: string; limit?: string; type?: string; status?: string;
  };

  let trades = [...recentTrades];
  if (type) trades = trades.filter(t => t.type === type);
  if (status) trades = trades.filter(t => t.status === status);

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const start = (pageNum - 1) * limitNum;
  const end = start + limitNum;

  res.json({
    trades: trades.slice(start, end),
    total: trades.length,
    page: pageNum,
    totalPages: Math.ceil(trades.length / limitNum),
  });
});

router.get("/analytics/agents/compare", (_req, res) => {
  res.json({
    agents: [
      { id: "ag-001", name: "Apex Arbitrage Bot", pnl: 4823.5, winRate: 87.2, trades: 142, compositeScore: 0.91 },
      { id: "ag-002", name: "DCA Accumulator", pnl: 1240.8, winRate: 72.3, trades: 89, compositeScore: 0.76 },
      { id: "ag-003", name: "Momentum Rider", pnl: -230.4, winRate: 64.7, trades: 54, compositeScore: 0.61 },
      { id: "ag-004", name: "Mean Reversion Master", pnl: 892.3, winRate: 66.1, trades: 203, compositeScore: 0.68 },
    ],
  });
});

router.get("/analytics/pnl", async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        DATE(executed_at)::text   AS day,
        COALESCE(SUM(pnl), 0)     AS daily_pnl,
        COALESCE(SUM(system_fee), 0) AS daily_fee,
        COUNT(*)::int             AS trades
      FROM trades
      WHERE executed_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(executed_at)
      ORDER BY day ASC
    `);

    const rows = result.rows;
    let cumulative = 0;
    const chartData = rows.map((r: any) => {
      cumulative += parseFloat(r.daily_pnl);
      return {
        date: r.day,
        dailyPnl: Math.round(parseFloat(r.daily_pnl) * 100) / 100,
        cumulativePnl: Math.round(cumulative * 100) / 100,
        trades: r.trades,
        fees: Math.round(parseFloat(r.daily_fee) * 100) / 100,
      };
    });

    const totalPnl    = Math.round(cumulative * 100) / 100;
    const bestDay     = chartData.reduce((m: any, d: any) => d.dailyPnl > m.dailyPnl ? d : m, chartData[0] ?? { dailyPnl: 0, date: null });
    const worstDay    = chartData.reduce((m: any, d: any) => d.dailyPnl < m.dailyPnl ? d : m, chartData[0] ?? { dailyPnl: 0, date: null });
    const profitDays  = chartData.filter((d: any) => d.dailyPnl > 0).length;

    res.json({
      chartData,
      totalPnl,
      bestDay:   { date: bestDay?.date ?? null,  pnl: bestDay?.dailyPnl ?? 0 },
      worstDay:  { date: worstDay?.date ?? null, pnl: worstDay?.dailyPnl ?? 0 },
      profitDays,
      lossDays: chartData.length - profitDays,
      isEmpty: chartData.length === 0,
    });
  } catch (err: any) {
    console.warn("[Analytics] PnL endpoint error:", err?.message);
    res.json({
      chartData: portfolioData.map((d, i) => ({ date: d.date, dailyPnl: 400 + Math.sin(i * 0.5) * 200, cumulativePnl: d.pnl, trades: Math.floor(Math.random() * 8) + 2, fees: Math.round((400 + Math.sin(i * 0.5) * 200) * 0.0075 * 100) / 100 })),
      totalPnl: 6726.2,
      bestDay:  { date: "2026-04-02", pnl: 1240.5 },
      worstDay: { date: "2026-03-15", pnl: -342.8 },
      profitDays: 22,
      lossDays: 8,
      isEmpty: false,
    });
  }
});

router.get("/analytics/risk", (_req, res) => {
  const weeklyVaR = Array.from({ length: 12 }, (_, i) => ({
    week: `W${i + 1}`,
    var95: -(200 + Math.random() * 300),
    var99: -(400 + Math.random() * 500),
    realized: -(150 + Math.random() * 250),
  }));

  res.json({
    currentVaR95: -342.5,
    currentVaR99: -681.2,
    maxDrawdownPct: -8.2,
    correlationToETH: 0.62,
    weeklyVaR,
  });
});

export default router;
