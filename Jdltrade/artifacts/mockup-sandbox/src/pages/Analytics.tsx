import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart2, TrendingUp, TrendingDown, Activity,
  Download, Filter, Calendar, Target, Zap
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import {
  PERFORMANCE_DATA, PORTFOLIO_CHART_DATA, RECENT_TRADES, AGENTS
} from "@/lib/mockData";
import { cn } from "@/lib/utils";

const ASSET_ALLOCATION = [
  { name: "ETH", value: 42, color: "#627EEA" },
  { name: "USDC", value: 28, color: "#2775CA" },
  { name: "WBTC", value: 18, color: "#F7931A" },
  { name: "Other", value: 12, color: "#8b5cf6" },
];

const RISK_METRICS = [
  { label: "Sharpe Ratio", value: "2.31", status: "good", desc: "Excellent risk-adjusted return" },
  { label: "Max Drawdown", value: "-8.2%", status: "good", desc: "Well within limits" },
  { label: "Volatility", value: "14.8%", status: "medium", desc: "Moderate volatility" },
  { label: "Sortino Ratio", value: "3.1", status: "good", desc: "Strong downside protection" },
  { label: "Calmar Ratio", value: "2.73", status: "good", desc: "Excellent" },
  { label: "Beta", value: "0.62", status: "good", desc: "Low market correlation" },
];

const statusColors = {
  good: "text-green-400 bg-green-500/10",
  medium: "text-yellow-400 bg-yellow-500/10",
  bad: "text-red-400 bg-red-500/10",
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1a2035] border border-white/10 rounded-lg p-3 shadow-xl">
        <p className="text-gray-400 text-xs mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} className="font-mono font-bold text-sm" style={{ color: p.color }}>
            {p.name}: ${p.value?.toLocaleString()}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const monthlyData = [
  { month: "Jan 26", agents: 2520, flash: 1200, total: 3720 },
  { month: "Feb 26", agents: 1640, flash: 920, total: 2560 },
  { month: "Mar 26", agents: 2310, flash: 1480, total: 3790 },
  { month: "Apr 26", agents: 1256, flash: 480, total: 1736 },
];

const weeklyWinRate = Array.from({ length: 14 }, (_, i) => ({
  day: `D${i + 1}`,
  rate: 60 + Math.random() * 25,
}));

export function Analytics() {
  const [period, setPeriod] = useState("30D");

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Analytics</h1>
          <p className="text-sm text-gray-400">Performance since inception</p>
        </div>
        <div className="flex items-center gap-2">
          {["7D", "30D", "90D", "All"].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs transition-colors",
                period === p ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" : "text-gray-400 hover:text-white bg-white/5"
              )}
            >
              {p}
            </button>
          ))}
          <Button variant="outline" size="sm" className="border-white/10 text-xs h-8 gap-1">
            <Download className="w-3 h-3" /> Export
          </Button>
        </div>
      </div>

      {/* Top KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: "Total P&L", value: "+$6,726", color: "text-green-400", sub: "+22.4%" },
          { label: "Win Rate", value: "74.6%", color: "text-white", sub: "488 trades" },
          { label: "Sharpe", value: "2.31", color: "text-blue-400", sub: "Excellent" },
          { label: "Max DD", value: "-8.2%", color: "text-yellow-400", sub: "Low risk" },
          { label: "Best Day", value: "+$1,240", color: "text-green-400", sub: "Mar 18" },
          { label: "Active Days", value: "78", color: "text-white", sub: "Since Jan" },
        ].map(kpi => (
          <Card key={kpi.label} className="bg-[#0d1225] border-white/5">
            <CardContent className="p-3">
              <div className="text-[10px] text-gray-500 mb-1">{kpi.label}</div>
              <div className={cn("text-base font-bold font-mono", kpi.color)}>{kpi.value}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">{kpi.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Portfolio chart + Asset allocation */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-[#0d1225] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              Cumulative P&L
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={PORTFOLIO_CHART_DATA}>
                <defs>
                  <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} interval={7} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "#1a2035", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                <Area type="monotone" dataKey="pnl" stroke="#22c55e" strokeWidth={2} fill="url(#pnlGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-[#0d1225] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Asset Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={ASSET_ALLOCATION} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                  {ASSET_ALLOCATION.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#1a2035", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                  formatter={(v: any) => [`${v}%`, ""]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {ASSET_ALLOCATION.map(a => (
                <div key={a.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: a.color }} />
                    <span className="text-gray-400">{a.name}</span>
                  </div>
                  <span className="font-mono font-semibold">{a.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly breakdown + Win rate */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="bg-[#0d1225] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly P&L Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v / 1000}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="agents" stackId="a" fill="#3b82f6" fillOpacity={0.8} name="Agents" radius={[0, 0, 0, 0]} />
                <Bar dataKey="flash" stackId="a" fill="#22c55e" fillOpacity={0.8} name="Flash Loans" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-[#0d1225] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-purple-400" />
              Daily Win Rate (14 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={weeklyWinRate}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="day" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis domain={[50, 100]} tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ background: "#1a2035", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} formatter={(v: any) => [`${v.toFixed(1)}%`, "Win Rate"]} />
                <Line type="monotone" dataKey="rate" stroke="#a855f7" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Risk Metrics */}
      <Card className="bg-[#0d1225] border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-red-400" />
            Risk Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {RISK_METRICS.map(metric => (
              <div key={metric.label} className="p-4 rounded-xl bg-white/3 border border-white/5">
                <div className="text-xs text-gray-500 mb-1">{metric.label}</div>
                <div className={cn("text-xl font-bold font-mono mb-1", statusColors[metric.status as keyof typeof statusColors].split(" ")[0])}>
                  {metric.value}
                </div>
                <div className="text-[10px] text-gray-600">{metric.desc}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Trade Journal */}
      <Card className="bg-[#0d1225] border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Trade Journal
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-400">
                <Filter className="w-3 h-3 mr-1" /> Filter
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-400">
                <Download className="w-3 h-3 mr-1" /> CSV
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  {["Time", "Agent", "Type", "Pair", "P&L", "Status", "Tx"].map(h => (
                    <th key={h} className="text-left py-2 pr-4 text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/3">
                {RECENT_TRADES.map(trade => (
                  <tr key={trade.id} className="hover:bg-white/3 transition-colors">
                    <td className="py-2.5 pr-4 text-gray-500 font-mono whitespace-nowrap">
                      {new Date(trade.timestamp).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-300 truncate max-w-[120px]">{trade.agent}</td>
                    <td className="py-2.5 pr-4">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded font-mono text-[10px]",
                        trade.type === "FLASH_LOAN" ? "bg-yellow-500/20 text-yellow-400" :
                        trade.type === "BUY" ? "bg-blue-500/20 text-blue-400" :
                        "bg-purple-500/20 text-purple-400"
                      )}>{trade.type}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-gray-300">{trade.pair}</td>
                    <td className={cn("py-2.5 pr-4 font-mono font-bold", trade.profit >= 0 ? "text-green-400" : "text-red-400")}>
                      {trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(1)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px]",
                        trade.status === "success" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                      )}>{trade.status}</span>
                    </td>
                    <td className="py-2.5 text-gray-600 font-mono">{trade.txHash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
