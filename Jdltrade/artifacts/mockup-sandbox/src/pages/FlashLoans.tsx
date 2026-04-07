import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Zap, Clock, TrendingUp, Filter, ArrowRight, CheckCircle2,
  XCircle, Flame, Activity, BarChart2, RefreshCw
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from "recharts";
import { FLASH_LOAN_OPPORTUNITIES, RECENT_TRADES } from "@/lib/mockData";
import { cn } from "@/lib/utils";

function RouteVisualization({ route, dexs }: { route: string[]; dexs: string[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {route.map((token, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/20 text-blue-300 text-xs font-mono">
            {token}
          </div>
          {i < route.length - 1 && (
            <div className="flex items-center gap-0.5">
              <ArrowRight className="w-3 h-3 text-gray-500" />
              <span className="text-[9px] text-gray-600">{dexs[i] || ""}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 0.9) return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">{(score * 100).toFixed(0)}% High</Badge>;
  if (score >= 0.8) return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">{(score * 100).toFixed(0)}% Med</Badge>;
  return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">{(score * 100).toFixed(0)}% Low</Badge>;
}

function ExecuteModal({ opportunity, onClose }: { opportunity: typeof FLASH_LOAN_OPPORTUNITIES[0]; onClose: () => void }) {
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<"success" | "failed" | null>(null);

  const handleExecute = async () => {
    setExecuting(true);
    await new Promise(r => setTimeout(r, 2500));
    setResult(Math.random() > 0.15 ? "success" : "failed");
    setExecuting(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0d1225] border-white/10 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Execute Flash Loan
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="text-center py-8 space-y-4">
            {result === "success" ? (
              <>
                <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto" />
                <div className="text-xl font-bold text-green-400">Flash Loan Successful!</div>
                <div className="text-gray-400 text-sm">Net profit: <span className="text-green-400 font-mono font-bold">${opportunity.netProfit.toFixed(2)}</span></div>
                <div className="text-xs text-gray-600 font-mono">Tx: 0xabc...{Math.random().toString(16).slice(2, 8)}</div>
              </>
            ) : (
              <>
                <XCircle className="w-16 h-16 text-red-400 mx-auto" />
                <div className="text-xl font-bold text-red-400">Transaction Failed</div>
                <div className="text-gray-400 text-sm">Slippage exceeded during execution. Gas refunded.</div>
              </>
            )}
            <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-700 w-full">Close</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-white/3 border border-white/5 space-y-3">
              <RouteVisualization route={opportunity.route} dexs={opportunity.dexs} />
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
                {[
                  { label: "Loan Amount", value: `$${(opportunity.loanAmount / 1000).toFixed(0)}K` },
                  { label: "Spread", value: `${opportunity.spreadPct}%` },
                  { label: "Est. Profit", value: `$${opportunity.estimatedProfit.toFixed(2)}` },
                  { label: "Gas Cost", value: `$${opportunity.gasCost.toFixed(2)}` },
                  { label: "Net Profit", value: `$${opportunity.netProfit.toFixed(2)}`, highlight: true },
                  { label: "Confidence", value: `${(opportunity.confidence * 100).toFixed(0)}%` },
                ].map(row => (
                  <div key={row.label} className={cn("flex justify-between", row.highlight ? "col-span-2 border-t border-white/5 pt-2" : "")}>
                    <span className="text-xs text-gray-500">{row.label}</span>
                    <span className={cn("text-xs font-mono font-bold", row.highlight ? "text-green-400 text-sm" : "text-white")}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/15 text-xs text-yellow-400">
              ⚡ Flash loans are atomic — if any step fails, the entire transaction reverts with no loss.
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1 border-white/10">
                Cancel
              </Button>
              <Button
                onClick={handleExecute}
                disabled={executing}
                className="flex-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30"
              >
                {executing ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Executing...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />Execute Now</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const flashHistory = RECENT_TRADES.filter(t => t.type === "FLASH_LOAN");

export function FlashLoans() {
  const [opportunities, setOpportunities] = useState(FLASH_LOAN_OPPORTUNITIES);
  const [autoExecute, setAutoExecute] = useState(false);
  const [selected, setSelected] = useState<typeof FLASH_LOAN_OPPORTUNITIES[0] | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setOpportunities(prev =>
        prev.map(o => ({
          ...o,
          expiresIn: Math.max(1, o.expiresIn - 1),
          netProfit: Math.max(10, o.netProfit + (Math.random() - 0.5) * 15),
          confidence: Math.min(0.98, Math.max(0.70, o.confidence + (Math.random() - 0.5) * 0.03)),
        }))
      );
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const monthlyData = [
    { month: "Jan", profit: 2840, count: 32 },
    { month: "Feb", profit: 1920, count: 21 },
    { month: "Mar", profit: 3610, count: 44 },
    { month: "Apr", profit: 980, count: 12 },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            Flash Loans
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          </h1>
          <p className="text-sm text-gray-400">{opportunities.length} live opportunities · Scanning Ethereum, Arbitrum, Polygon</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-execute"
              checked={autoExecute}
              onCheckedChange={setAutoExecute}
            />
            <Label htmlFor="auto-execute" className="text-sm text-gray-400">
              Auto-Execute <Badge className="ml-1 bg-purple-500/15 text-purple-400 text-[10px]">Elite</Badge>
            </Label>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Profit (30d)", value: "$9,350", icon: TrendingUp, color: "text-green-400" },
          { label: "Flash Loans (30d)", value: "109", icon: Zap, color: "text-yellow-400" },
          { label: "Success Rate", value: "94.5%", icon: CheckCircle2, color: "text-blue-400" },
          { label: "Avg Net Profit", value: "$85.8", icon: BarChart2, color: "text-purple-400" },
        ].map(s => (
          <Card key={s.label} className="bg-[#0d1225] border-white/5">
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={cn("w-8 h-8 p-1.5 rounded-lg bg-white/5", s.color)} />
              <div>
                <div className="text-xs text-gray-500">{s.label}</div>
                <div className={cn("text-lg font-bold font-mono", s.color)}>{s.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Live opportunities */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              Live Opportunities
            </h2>
            <Button variant="ghost" size="sm" className="text-xs text-gray-400 h-7">
              <Filter className="w-3 h-3 mr-1" /> Filter
            </Button>
          </div>

          {opportunities.map(opp => (
            <Card key={opp.id} className="bg-[#0d1225] border-white/5 hover:border-yellow-500/20 transition-all">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <RouteVisualization route={opp.route} dexs={opp.dexs} />
                  </div>
                  <ConfidenceBadge score={opp.confidence} />
                </div>

                <div className="grid grid-cols-4 gap-3 mt-3">
                  <div>
                    <div className="text-[10px] text-gray-500">Loan</div>
                    <div className="text-xs font-mono font-semibold">${(opp.loanAmount / 1000).toFixed(0)}K</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Spread</div>
                    <div className="text-xs font-mono font-semibold text-blue-400">{opp.spreadPct}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Gas</div>
                    <div className="text-xs font-mono font-semibold text-orange-400">${opp.gasCost.toFixed(0)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Net Profit</div>
                    <div className="text-sm font-mono font-bold text-green-400">${opp.netProfit.toFixed(0)}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    Expires in {opp.expiresIn}s · {opp.network}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setSelected(opp)}
                    className="h-7 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30 text-xs"
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Execute
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Monthly chart */}
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Monthly Profit</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#1a2035", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    labelStyle={{ color: "#9ca3af" }}
                    itemStyle={{ color: "#22c55e" }}
                  />
                  <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                    {monthlyData.map((_, i) => <Cell key={i} fill="#22c55e" fillOpacity={0.7} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* History */}
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent Executions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {flashHistory.map(trade => (
                <div key={trade.id} className="flex items-center gap-3">
                  {trade.status === "success"
                    ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                    : <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{trade.pair}</div>
                    <div className="text-[10px] text-gray-500 font-mono truncate">{trade.txHash}</div>
                  </div>
                  <div className={cn("text-sm font-bold font-mono shrink-0", trade.profit >= 0 ? "text-green-400" : "text-red-400")}>
                    {trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(0)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {selected && <ExecuteModal opportunity={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
