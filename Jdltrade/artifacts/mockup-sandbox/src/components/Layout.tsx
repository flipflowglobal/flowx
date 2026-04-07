import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Bot,
  Zap,
  Wallet,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bell,
  TrendingUp,
  TrendingDown,
  Activity,
  Menu,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MARKET_DATA, USER } from "@/lib/mockData";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "agents", label: "Agents", icon: Bot, badge: "4" },
  { id: "flash-loans", label: "Flash Loans", icon: Zap, badge: "Live" },
  { id: "wallets", label: "Wallets", icon: Wallet },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
];

interface LayoutProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  children: React.ReactNode;
}

export function Layout({ currentPage, onNavigate, children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-[#0a0e1a] text-white overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:relative z-30 h-full flex flex-col border-r border-white/5 bg-[#0d1225] transition-all duration-300",
          collapsed ? "w-16" : "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-sm font-bold tracking-wider text-white">D.L-AI</div>
              <div className="text-[10px] text-blue-400/70 tracking-widest uppercase">Trading Platform</div>
            </div>
          )}
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-blue-600/20 text-blue-400 border border-blue-500/20"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0", active ? "text-blue-400" : "")} />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge && (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0 h-4",
                          item.badge === "Live"
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-white/10 text-gray-300"
                        )}
                      >
                        {item.badge}
                      </Badge>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {/* User info */}
        {!collapsed && (
          <div className="px-3 py-3 border-t border-white/5">
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 cursor-pointer">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs font-bold shrink-0">
                {USER.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{USER.name}</div>
                <div className="flex items-center gap-1">
                  <Badge className="text-[9px] px-1 py-0 h-3.5 bg-blue-500/20 text-blue-400 border-blue-500/30">
                    {USER.subscription.toUpperCase()}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex items-center justify-center p-2 m-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center gap-4 px-4 lg:px-6 border-b border-white/5 bg-[#0a0e1a]/80 backdrop-blur shrink-0">
          <button
            className="lg:hidden text-gray-400 hover:text-white"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Market ticker */}
          <div className="hidden md:flex items-center gap-6 text-sm flex-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-400">ETH</span>
              <span className="font-mono font-semibold">${MARKET_DATA.ethPrice.toLocaleString()}</span>
              <span className={cn("flex items-center gap-0.5 text-xs", MARKET_DATA.ethChange24h >= 0 ? "text-green-400" : "text-red-400")}>
                {MARKET_DATA.ethChange24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(MARKET_DATA.ethChange24h)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Gas</span>
              <span className="font-mono font-semibold text-orange-400">{MARKET_DATA.gasPrice} Gwei</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">BTC</span>
              <span className="font-mono font-semibold">${MARKET_DATA.btcPrice.toLocaleString()}</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" className="relative text-gray-400 hover:text-white">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-blue-500 rounded-full" />
            </Button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs font-bold cursor-pointer">
              {USER.name[0]}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
