import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Bot, Play, Pause, Trash2, Plus, TrendingUp, TrendingDown,
  Activity, Cpu, ChevronRight, BarChart2, Zap, Shield, Search
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AGENTS, STRATEGIES } from "@/lib/mockData";
import { cn } from "@/lib/utils";

const RISK_COLORS: Record<string, string> = {
  Conservative: "text-green-400 bg-green-500/10 border-green-500/20",
  Balanced: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  Aggressive: "text-red-400 bg-red-500/10 border-red-500/20",
};

function AgentCard({ agent, onSelect }: { agent: typeof AGENTS[0]; onSelect: () => void }) {
  const isRunning = agent.status === "running";
  const pnlData = Array.from({ length: 20 }, (_, i) => ({
    i, v: agent.pnl * (0.5 + (i / 20) * 0.5) + Math.sin(i * 0.8) * 100
  }));

  return (
    <Card
      className="bg-[#0d1225] border-white/5 hover:border-blue-500/20 transition-all cursor-pointer group"
      onClick={onSelect}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              isRunning ? "bg-green-500/15" : "bg-gray-500/15"
            )}>
              <Bot className={cn("w-5 h-5", isRunning ? "text-green-400" : "text-gray-400")} />
            </div>
            <div>
              <div className="font-semibold text-sm">{agent.name}</div>
              <div className="text-xs text-gray-500">{agent.strategy}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={cn("text-[10px] border", RISK_COLORS[agent.riskProfile])}>
              {agent.riskProfile}
            </Badge>
            <div className={cn(
              "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
              isRunning ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-gray-400 bg-gray-500/10 border-gray-500/20"
            )}>
              <div className={cn("w-1.5 h-1.5 rounded-full", isRunning ? "bg-green-400 animate-pulse" : "bg-gray-400")} />
              {agent.status}
            </div>
          </div>
        </div>

        {/* Mini chart */}
        <div className="h-16 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pnlData}>
              <Line type="monotone" dataKey="v" stroke={agent.pnl >= 0 ? "#22c55e" : "#ef4444"} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[10px] text-gray-500 mb-0.5">P&L</div>
            <div className={cn("text-sm font-bold font-mono", agent.pnl >= 0 ? "text-green-400" : "text-red-400")}>
              {agent.pnl >= 0 ? "+" : ""}${agent.pnl.toFixed(0)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 mb-0.5">Win Rate</div>
            <div className="text-sm font-bold font-mono text-white">{agent.winRate}%</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 mb-0.5">Trades</div>
            <div className="text-sm font-bold font-mono text-white">{agent.totalTrades}</div>
          </div>
        </div>

        {/* AI Score */}
        <div className="mb-3">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-gray-500">AI Composite Score</span>
            <span className="text-blue-400 font-mono">{(agent.composite_score * 100).toFixed(0)}%</span>
          </div>
          <Progress value={agent.composite_score * 100} className="h-1 bg-white/5" />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-white/5" onClick={e => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 text-xs flex-1", isRunning ? "text-yellow-400 hover:bg-yellow-500/10" : "text-green-400 hover:bg-green-500/10")}
          >
            {isRunning ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
            {isRunning ? "Pause" : "Resume"}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-400 hover:bg-blue-500/10" onClick={onSelect}>
            <ChevronRight className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:bg-red-500/10">
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [riskProfile, setRiskProfile] = useState("Balanced");
  const [capital, setCapital] = useState([5000]);

  const strategy = STRATEGIES.find(s => s.id === selectedStrategy);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#0d1225] border-white/10 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-400" />
            Create AI Agent
            <span className="text-sm text-gray-500 font-normal">Step {step} of 3</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          {[1, 2, 3].map(s => (
            <div key={s} className={cn("h-1 flex-1 rounded-full transition-colors", s <= step ? "bg-blue-500" : "bg-white/10")} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">Select a validated strategy (all 60%+ win rate)</p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input placeholder="Search strategies..." className="pl-9 bg-white/5 border-white/10" />
            </div>
            <div className="grid grid-cols-1 gap-3">
              {STRATEGIES.map(s => (
                <div
                  key={s.id}
                  onClick={() => setSelectedStrategy(s.id)}
                  className={cn(
                    "p-4 rounded-xl border cursor-pointer transition-all",
                    selectedStrategy === s.id
                      ? "border-blue-500/50 bg-blue-500/10"
                      : "border-white/5 bg-white/3 hover:border-white/15"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold text-sm">{s.name}</div>
                    <div className="flex items-center gap-2">
                      <Badge className={cn(
                        "text-[10px] border",
                        s.risk === "Low" ? "text-green-400 bg-green-500/10 border-green-500/20" :
                        s.risk === "Medium" ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" :
                        "text-red-400 bg-red-500/10 border-red-500/20"
                      )}>{s.risk}</Badge>
                      <span className="text-green-400 font-mono text-sm font-bold">{s.winRate}%</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">{s.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span>Min: ${s.minCapital.toLocaleString()}</span>
                    <span>Networks: {s.networks.join(", ")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <Label className="text-sm mb-3 block">Risk Profile</Label>
              <div className="grid grid-cols-3 gap-3">
                {["Conservative", "Balanced", "Aggressive"].map(r => (
                  <button
                    key={r}
                    onClick={() => setRiskProfile(r)}
                    className={cn(
                      "py-3 rounded-xl border text-sm font-medium transition-all",
                      riskProfile === r ? "border-blue-500/50 bg-blue-500/10 text-white" : "border-white/10 text-gray-400 hover:border-white/20"
                    )}
                  >
                    <Shield className={cn("w-4 h-4 mx-auto mb-1", r === "Conservative" ? "text-green-400" : r === "Balanced" ? "text-yellow-400" : "text-red-400")} />
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-sm mb-3 flex justify-between">
                Capital Allocation
                <span className="text-blue-400 font-mono">${capital[0].toLocaleString()}</span>
              </Label>
              <Slider
                value={capital}
                onValueChange={setCapital}
                min={strategy?.minCapital ?? 500}
                max={50000}
                step={500}
                className="mb-2"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>Min: ${strategy?.minCapital?.toLocaleString() ?? "500"}</span>
                <span>Max: $50,000</span>
              </div>
            </div>

            <div>
              <Label className="text-sm mb-2 block">Network</Label>
              <Select defaultValue="Ethereum">
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1225] border-white/10">
                  <SelectItem value="Ethereum">Ethereum</SelectItem>
                  <SelectItem value="Arbitrum">Arbitrum</SelectItem>
                  <SelectItem value="Polygon">Polygon</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-white/3 border border-white/5 space-y-3">
              <h3 className="font-semibold text-sm text-gray-300">Agent Configuration Summary</h3>
              {[
                { label: "Strategy", value: STRATEGIES.find(s => s.id === selectedStrategy)?.name ?? "—" },
                { label: "Risk Profile", value: riskProfile },
                { label: "Capital", value: `$${capital[0].toLocaleString()}` },
                { label: "Estimated Win Rate", value: `${STRATEGIES.find(s => s.id === selectedStrategy)?.winRate ?? 0}%` },
              ].map(row => (
                <div key={row.label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{row.label}</span>
                  <span className="font-medium">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/10">
              <div className="flex items-center gap-2 text-green-400 text-sm mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="font-semibold">Backtesting Preview (90 days)</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center mt-3">
                <div><div className="text-lg font-bold text-white">{STRATEGIES.find(s => s.id === selectedStrategy)?.winRate ?? 0}%</div><div className="text-xs text-gray-500">Win Rate</div></div>
                <div><div className="text-lg font-bold text-green-400">+{((STRATEGIES.find(s => s.id === selectedStrategy)?.avgReturn ?? 1) * 90).toFixed(0)}%</div><div className="text-xs text-gray-500">Est. Return</div></div>
                <div><div className="text-lg font-bold text-white">2.1</div><div className="text-xs text-gray-500">Sharpe</div></div>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} className="border-white/10">
              Back
            </Button>
          )}
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            disabled={step === 1 && !selectedStrategy}
            onClick={() => {
              if (step < 3) setStep(s => s + 1);
              else { onClose(); setStep(1); }
            }}
          >
            {step === 3 ? "Deploy Agent" : "Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Agents() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<typeof AGENTS[0] | null>(null);
  const [filter, setFilter] = useState("all");

  const filtered = AGENTS.filter(a => filter === "all" || a.status === filter);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AI Agents</h1>
          <p className="text-sm text-gray-400">{AGENTS.filter(a => a.status === "running").length} active · {AGENTS.length} total</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          New Agent
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total P&L", value: "+$6,726", color: "text-green-400" },
          { label: "Avg Win Rate", value: "72.6%", color: "text-white" },
          { label: "Active Trades", value: "6", color: "text-blue-400" },
          { label: "Agents Used", value: "4 / 10", color: "text-white" },
        ].map(s => (
          <Card key={s.label} className="bg-[#0d1225] border-white/5">
            <CardContent className="p-4">
              <div className="text-xs text-gray-500 mb-1">{s.label}</div>
              <div className={cn("text-xl font-bold font-mono", s.color)}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {["all", "running", "paused"].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm capitalize transition-colors",
              filter === f ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" : "text-gray-400 hover:text-white bg-white/5"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Agent cards */}
      <div className="grid md:grid-cols-2 xl:grid-cols-2 gap-4">
        {filtered.map(agent => (
          <AgentCard key={agent.id} agent={agent} onSelect={() => setSelectedAgent(agent)} />
        ))}
      </div>

      <CreateAgentDialog open={showCreate} onClose={() => setShowCreate(false)} />

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <Dialog open={!!selectedAgent} onOpenChange={() => setSelectedAgent(null)}>
          <DialogContent className="bg-[#0d1225] border-white/10 max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-blue-400" />
                {selectedAgent.name}
                <Badge className={selectedAgent.status === "running" ? "bg-green-500/15 text-green-400" : "bg-gray-500/15 text-gray-400"}>
                  {selectedAgent.status}
                </Badge>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Strategy", value: selectedAgent.strategy },
                  { label: "Network", value: selectedAgent.network },
                  { label: "Risk Profile", value: selectedAgent.riskProfile },
                  { label: "Capital", value: `$${selectedAgent.capital.toLocaleString()}` },
                  { label: "Total Trades", value: selectedAgent.totalTrades },
                  { label: "Active Trades", value: selectedAgent.activeTrades },
                ].map(row => (
                  <div key={row.label} className="p-3 rounded-xl bg-white/3 border border-white/5">
                    <div className="text-xs text-gray-500 mb-0.5">{row.label}</div>
                    <div className="font-semibold text-sm">{row.value}</div>
                  </div>
                ))}
              </div>
              <div className="p-4 rounded-xl bg-white/3 border border-white/5">
                <div className="text-xs text-gray-500 mb-3">AI Engine Confidence Scores</div>
                <div className="space-y-2.5">
                  {Object.entries(selectedAgent.engines).map(([engine, score]) => (
                    <div key={engine}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400 capitalize">{engine.replace("_", " ")}</span>
                        <span className="font-mono text-white">{(score * 100).toFixed(0)}%</span>
                      </div>
                      <Progress value={score * 100} className="h-1.5 bg-white/5" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-white/10 text-yellow-400 hover:bg-yellow-500/10">
                  <Pause className="w-4 h-4 mr-2" />
                  Pause Agent
                </Button>
                <Button className="flex-1 bg-blue-600 hover:bg-blue-700">
                  <BarChart2 className="w-4 h-4 mr-2" />
                  View Analytics
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
