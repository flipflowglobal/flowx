import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  User, CreditCard, Shield, Bell, Cpu, CheckCircle2,
  Crown, Star, Zap, ChevronRight, Key, Smartphone, LogOut
} from "lucide-react";
import { USER, SUBSCRIPTION_TIERS } from "@/lib/mockData";
import { cn } from "@/lib/utils";

function TierCard({ tier, current }: { tier: typeof SUBSCRIPTION_TIERS[0]; current: boolean }) {
  return (
    <div className={cn(
      "relative p-5 rounded-xl border transition-all",
      current ? "border-blue-500/40 bg-blue-500/10" : "border-white/5 bg-white/3 hover:border-white/15",
      tier.recommended ? "ring-1 ring-blue-500/30" : ""
    )}>
      {tier.recommended && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded-full">
          RECOMMENDED
        </div>
      )}
      {current && (
        <div className="absolute -top-2.5 right-4 px-3 py-0.5 bg-green-600 text-white text-[10px] font-bold rounded-full flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" /> Current Plan
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        {tier.id === "free" && <Star className="w-5 h-5 text-gray-400" />}
        {tier.id === "pro" && <Zap className="w-5 h-5 text-blue-400" />}
        {tier.id === "elite" && <Crown className="w-5 h-5 text-yellow-400" />}
        <div className="text-base font-bold">{tier.name}</div>
      </div>
      <div className="text-2xl font-bold font-mono mb-1">
        {tier.price === 0 ? "Free" : `$${tier.price}`}
        {tier.price > 0 && <span className="text-sm font-normal text-gray-500">/mo</span>}
      </div>

      <div className="space-y-1.5 mb-4 mt-3">
        {tier.features.map(f => (
          <div key={f} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
            <span className="text-gray-300">{f}</span>
          </div>
        ))}
      </div>

      {!current && (
        <Button
          className={cn(
            "w-full",
            tier.id === "elite" ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30" :
            tier.price > 0 ? "bg-blue-600 hover:bg-blue-700" :
            "border-white/10 text-gray-300"
          )}
          variant={tier.price === 0 ? "outline" : "default"}
        >
          {tier.price > Number(SUBSCRIPTION_TIERS.find(t => t.id === USER.subscription)?.price ?? 0) ? "Upgrade" : "Downgrade"}
        </Button>
      )}
    </div>
  );
}

export function Settings() {
  const [notifications, setNotifications] = useState({
    tradeAlerts: true,
    flashLoans: true,
    agentStatus: true,
    priceAlerts: false,
    email: true,
    push: true,
  });

  const [twoFA, setTwoFA] = useState(USER.twoFAEnabled);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-gray-400">Manage your account, subscription, and preferences</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="bg-white/5 border border-white/10 flex-wrap h-auto gap-1 p-1">
          {[
            { id: "profile", label: "Profile", icon: User },
            { id: "subscription", label: "Subscription", icon: CreditCard },
            { id: "security", label: "Security", icon: Shield },
            { id: "notifications", label: "Notifications", icon: Bell },
            { id: "ai-config", label: "AI Config", icon: Cpu },
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-1.5 text-xs data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-400">
                <Icon className="w-3 h-3" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile" className="space-y-4">
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="w-4 h-4 text-blue-400" />
                Profile Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-2xl font-bold shrink-0">
                  {USER.name[0]}
                </div>
                <div>
                  <div className="font-semibold text-base">{USER.name}</div>
                  <div className="text-sm text-gray-400">{USER.email}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className="bg-green-500/15 text-green-400 border-green-500/20 text-[10px]">
                      <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                      KYC Verified
                    </Badge>
                    <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-[10px]">
                      Pro Plan
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-gray-400 mb-1.5 block">Full Name</Label>
                  <Input defaultValue={USER.name} className="bg-white/5 border-white/10" />
                </div>
                <div>
                  <Label className="text-xs text-gray-400 mb-1.5 block">Email</Label>
                  <Input defaultValue={USER.email} className="bg-white/5 border-white/10" />
                </div>
                <div>
                  <Label className="text-xs text-gray-400 mb-1.5 block">Default Network</Label>
                  <Input defaultValue="Ethereum" className="bg-white/5 border-white/10" />
                </div>
                <div>
                  <Label className="text-xs text-gray-400 mb-1.5 block">Currency Display</Label>
                  <Input defaultValue="USD" className="bg-white/5 border-white/10" />
                </div>
              </div>

              <Button className="bg-blue-600 hover:bg-blue-700">Save Changes</Button>
            </CardContent>
          </Card>

          <Card className="bg-[#0d1225] border-white/5">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">Connected Wallet</div>
                  <div className="text-xs text-gray-500 font-mono mt-0.5">{USER.walletAddress}</div>
                </div>
                <Button variant="outline" size="sm" className="border-white/10 text-xs">Change</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Subscription */}
        <TabsContent value="subscription" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            {SUBSCRIPTION_TIERS.map(tier => (
              <TierCard key={tier.id} tier={tier} current={tier.id === USER.subscription} />
            ))}
          </div>
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Usage This Month</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "AI Agents", used: 4, limit: 10 },
                { label: "Flash Loans", used: 109, limit: "∞" },
                { label: "API Calls", used: 8420, limit: 50000 },
              ].map(usage => (
                <div key={usage.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">{usage.label}</span>
                    <span className="text-white font-mono">{usage.used} / {usage.limit}</span>
                  </div>
                  {typeof usage.limit === "number" && (
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${(usage.used / (usage.limit as number)) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="space-y-4">
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-yellow-400" />
                Security Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  icon: <Key className="w-4 h-4 text-blue-400" />,
                  title: "Two-Factor Authentication",
                  desc: "Add an extra layer of security using TOTP",
                  action: <Switch checked={twoFA} onCheckedChange={setTwoFA} />,
                },
                {
                  icon: <Smartphone className="w-4 h-4 text-green-400" />,
                  title: "Biometric Auth",
                  desc: "Use Face ID / Touch ID for authentication",
                  action: <Switch defaultChecked />,
                },
                {
                  icon: <Shield className="w-4 h-4 text-purple-400" />,
                  title: "Session Timeout",
                  desc: "Auto-lock after 30 minutes of inactivity",
                  action: <Switch defaultChecked />,
                },
              ].map(item => (
                <div key={item.title} className="flex items-center justify-between p-4 rounded-xl bg-white/3 border border-white/5">
                  <div className="flex items-center gap-3">
                    {item.icon}
                    <div>
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="text-xs text-gray-500">{item.desc}</div>
                    </div>
                  </div>
                  {item.action}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-[#0d1225] border-white/5">
            <CardContent className="p-5">
              <div className="text-sm font-semibold mb-3">Change Password</div>
              <div className="space-y-3">
                <Input type="password" placeholder="Current password" className="bg-white/5 border-white/10" />
                <Input type="password" placeholder="New password" className="bg-white/5 border-white/10" />
                <Input type="password" placeholder="Confirm new password" className="bg-white/5 border-white/10" />
                <Button className="bg-blue-600 hover:bg-blue-700">Update Password</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0d1225] border-red-500/10 border">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 text-red-400">
                <LogOut className="w-4 h-4" />
                <div>
                  <div className="font-semibold text-sm">Sign Out All Devices</div>
                  <div className="text-xs text-red-400/60">This will invalidate all active sessions</div>
                </div>
                <Button variant="outline" size="sm" className="ml-auto border-red-500/30 text-red-400 hover:bg-red-500/10">
                  Sign Out
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications" className="space-y-4">
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Notification Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { key: "tradeAlerts" as const, label: "Trade Alerts", desc: "Notify on every trade execution" },
                { key: "flashLoans" as const, label: "Flash Loan Opportunities", desc: "Live alerts for high-confidence opportunities" },
                { key: "agentStatus" as const, label: "Agent Status Changes", desc: "When agents pause, error, or resume" },
                { key: "priceAlerts" as const, label: "Price Alerts", desc: "ETH/BTC price threshold alerts" },
                { key: "email" as const, label: "Email Notifications", desc: "Daily summary and critical alerts" },
                { key: "push" as const, label: "Push Notifications", desc: "Browser push notifications" },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">{item.label}</Label>
                    <div className="text-xs text-gray-500">{item.desc}</div>
                  </div>
                  <Switch
                    checked={notifications[item.key]}
                    onCheckedChange={v => setNotifications(prev => ({ ...prev, [item.key]: v }))}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Config */}
        <TabsContent value="ai-config" className="space-y-4">
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-400" />
                Aureon AI Engine Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "PPO Engine Weight", key: "ppo", value: 0.25, desc: "Proximal Policy Optimization reinforcement learning" },
                { label: "Thompson Sampling Weight", key: "ts", value: 0.28, desc: "Bayesian exploration-exploitation balance" },
                { label: "UKF State Estimator Weight", key: "ukf", value: 0.22, desc: "Unscented Kalman Filter market state estimation" },
                { label: "CMA-ES Optimizer Weight", key: "cma", value: 0.25, desc: "Covariance Matrix Adaptation Evolution Strategy" },
              ].map(engine => (
                <div key={engine.key} className="p-4 rounded-xl bg-white/3 border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-sm">{engine.label}</div>
                    <div className="font-mono text-blue-400 font-bold">{(engine.value * 100).toFixed(0)}%</div>
                  </div>
                  <div className="text-xs text-gray-500 mb-2">{engine.desc}</div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${engine.value * 100}%` }} />
                  </div>
                </div>
              ))}
              <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/15 text-xs text-blue-400">
                Weights are dynamically rebalanced using Shapley value attribution. Manual overrides take effect on next agent cycle.
              </div>
              <Button className="bg-blue-600 hover:bg-blue-700">Apply Configuration</Button>
            </CardContent>
          </Card>

          <Card className="bg-[#0d1225] border-white/5">
            <CardContent className="p-5 space-y-3">
              <div className="font-semibold text-sm">DEX Configuration</div>
              {["Uniswap V3", "SushiSwap", "Curve Finance", "Balancer", "1inch"].map(dex => (
                <div key={dex} className="flex items-center justify-between">
                  <Label className="text-sm text-gray-300">{dex}</Label>
                  <Switch defaultChecked={["Uniswap V3", "Curve Finance", "Balancer"].includes(dex)} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
