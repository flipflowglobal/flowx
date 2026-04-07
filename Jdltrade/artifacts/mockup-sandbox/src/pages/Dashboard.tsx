import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp, TrendingDown, Bot, Zap, Wallet, Activity,
  ArrowUpRight, ArrowDownRight, Clock, ChevronRight, Cpu
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line
} from "recharts";
import {
  AGENTS, FLASH_LOAN_OPPORTUNITIES, PORTFOLIO_CHART_DATA,
  PERFORMANCE_DATA, RECENT_TRADES, MARKET_DATA
} from "@/lib/mockData";
import { cn } from "@/lib/utils";

function StatCard({
  title, value, change, prefix = "", suffix = "", icon: Icon, color = "blue"
}: {
  title: string; value: number | string; change?: number;
  prefix?: string; suffix?: string; icon: React.ElementType; color?: string;
}) {
  const colors: Record<string, string> = {
    blue: "from-blue-500/10 to-blue-600/5 border-blue-500/10",
    green: "from-green-500/10 to-green-600/5 border-green-500/10",
    purple: "from-purple-500/10 to-purple-600/5 border-purple-500/10",
    orange: "from-orange-500/10 to-orange-600/5 border-orange-500/10",
  };
  const iconColors: Record<string, string> = {
    blue: "bg-blue-500/15 text-blue-400",
    green: "bg-green-500/15 text-green-400",
    purple: "bg-purple-500/15 text-purple-400",
    orange: "bg-orange-500/15 text-orange-400",
  };
  return (
    <Card className={cn("bg-gradient-to-br border", colors[color], "bg-[#0d1225]")}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-1">{title}</p>
            <p className="text-2xl font-bold font-mono">
              {prefix}{typeof value === "number" ? value.toLocaleString() : value}{suffix}
            </p>
            {change !== undefined && (
              <div className={cn("flex items-center gap-1 text-xs mt-1", change >= 0 ? "text-green-400" : "text-red-400")}>
                {change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(change)}% vs last week
              </div>
            )}
          </div>
          <div className={cn("p-2.5 rounded-xl", iconColors[color])}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1a2035] border border-white/10 rounded-lg p-3 shadow-xl">
        <p className="text-gray-400 text-xs mb-1">{label}</p>
        <p className="text-white font-mono font-bold">${payload[0].value.toLocaleString()}</p>
      </div>
    );
  }
  return null;
};

export function Dashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [liveOpps, setLiveOpps] = useState(FLASH_LOAN_OPPORTUNITIES);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveOpps(prev =>
        prev.map(o => ({
          ...o,
          expiresIn: Math.max(1, o.expiresIn - 1),
          netProfit: o.netProfit + (Math.random() - 0.5) * 10,
        }))
      );
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const runningAgents = AGENTS.filter(a => a.status === "running");
  const totalPortfolioValue = 46000;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-400">Welcome back — your bots are working.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-full">
            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            Live
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Portfolio Value"
          value={totalPortfolioValue}
          prefix="$"
          change={5.2}
          icon={Wallet}
          color="blue"
        />
        <StatCard
          title="Total P&L"
          value={PERFORMANCE_DATA.totalPnl}
          prefix="$"
          change={22.4}
          icon={TrendingUp}
          color="green"
        />
        <StatCard
          title="Active Agents"
          value={runningAgents.length}
          suffix=" / 4"
          icon={Bot}
          color="purple"
        />
        <StatCard
          title="Win Rate"
          value={PERFORMANCE_DATA.winRate}
          suffix="%"
          change={2.1}
          icon={Activity}
          color="orange"
        />
      </div>

      {/* Chart + Quick Stats */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Portfolio chart */}
        <Card className="lg:col-span-2 bg-[#0d1225] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span>Portfolio Performance</span>
              <div className="flex gap-1">
                {["7D", "30D", "All"].map(t => (
                  <button key={t} className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    t === "30D" ? "bg-blue-600/30 text-blue-400" : "text-gray-500 hover:text-gray-300"
                  )}>{t}</button>
                ))}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={PORTFOLIO_CHART_DATA}>
                <defs>
                  <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} interval={6} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fill="url(#portfolioGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* AI Engine Scores */}
        <Card className="bg-[#0d1225] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-400" />
              AI Engine Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { name: "PPO Engine", score: 0.88, color: "blue" },
              { name: "Thompson Sampling", score: 0.93, color: "green" },
              { name: "UKF Estimator", score: 0.87, color: "purple" },
              { name: "CMA-ES Optimizer", score: 0.89, color: "orange" },
            ].map(engine => (
              <div key={engine.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">{engine.name}</span>
                  <span className="font-mono text-white">{(engine.score * 100).toFixed(0)}%</span>
                </div>
                <Progress
                  value={engine.score * 100}
                  className="h-1.5 bg-white/5"
                />
              </div>
            ))}
            <div className="pt-2 border-t border-white/5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Composite Score</span>
                <span className="font-mono text-blue-400 font-bold">91.4%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Agents + Flash Loan Feed */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Active Agents */}
        <Card className="bg-[#0d1225] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-400" />
                Active Agents
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-blue-400 h-7" onClick={() => onNavigate("agents")}>
                View All <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {AGENTS.map(agent => (
              <div key={agent.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/3 hover:bg-white/5 transition-colors cursor-pointer border border-white/3">
                <div className={cn("w-2 h-2 rounded-full shrink-0", agent.status === "running" ? "bg-green-400 animate-pulse" : "bg-gray-500")} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{agent.name}</div>
                  <div className="text-xs text-gray-500">{agent.strategy}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={cn("text-sm font-mono font-bold", agent.pnl >= 0 ? "text-green-400" : "text-red-400")}>
                    {agent.pnl >= 0 ? "+" : ""}${agent.pnl.toFixed(0)}
                  </div>
                  <div className="text-xs text-gray-500">{agent.winRate}% WR</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Flash Loan Opportunities */}
        <Card className="bg-[#0d1225] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                Live Opportunities
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-blue-400 h-7" onClick={() => onNavigate("flash-loans")}>
                Scanner <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {liveOpps.slice(0, 4).map(opp => (
              <div key={opp.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/3 border border-white/3 hover:bg-white/5 transition-colors cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-gray-300 truncate">{opp.route.join(" → ")}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{opp.dexs.join(" · ")}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-green-400">+${opp.netProfit.toFixed(0)}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 justify-end">
                    <Clock className="w-2.5 h-2.5" />
                    {opp.expiresIn}s
                  </div>
                </div>
                <div className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-mono",
                  opp.confidence >= 0.9 ? "bg-green-500/20 text-green-400" :
                  opp.confidence >= 0.8 ? "bg-yellow-500/20 text-yellow-400" :
                  "bg-orange-500/20 text-orange-400"
                )}>
                  {(opp.confidence * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recent Trades */}
      <Card className="bg-[#0d1225] border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            Recent Trades
            <Button variant="ghost" size="sm" className="text-xs text-blue-400 h-7" onClick={() => onNavigate("analytics")}>
              View All <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {RECENT_TRADES.slice(0, 5).map(trade => (
              <div key={trade.id} className="flex items-center gap-4 py-2 border-b border-white/5 last:border-0">
                <div className={cn(
                  "text-[10px] px-2 py-0.5 rounded font-mono shrink-0",
                  trade.type === "FLASH_LOAN" ? "bg-yellow-500/20 text-yellow-400" :
                  trade.type === "BUY" ? "bg-blue-500/20 text-blue-400" :
                  "bg-purple-500/20 text-purple-400"
                )}>
                  {trade.type}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{trade.pair}</div>
                  <div className="text-[10px] text-gray-500 truncate">{trade.agent}</div>
                </div>
                <div className={cn("text-sm font-mono font-bold shrink-0", trade.profit >= 0 ? "text-green-400" : "text-red-400")}>
                  {trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(1)}
                </div>
                <Badge variant="secondary" className={cn(
                  "text-[10px] shrink-0",
                  trade.status === "success" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                )}>
                  {trade.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
