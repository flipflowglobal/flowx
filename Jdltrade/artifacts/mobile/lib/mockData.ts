export const portfolioData = {
  totalValue: 284750.42,
  dailyChange: 3847.22,
  dailyChangePercent: 1.37,
  weeklyChange: 12450.0,
  weeklyChangePercent: 4.57,
};

export const aiEngines = [
  { id: "ppo", name: "PPO Agent", accuracy: 88.2, status: "active" as const, trades: 1247, shapleyWeight: 0.22 },
  { id: "thompson", name: "Thompson Sampling", accuracy: 93.1, status: "active" as const, trades: 892, shapleyWeight: 0.31 },
  { id: "ukf", name: "UKF Filter", accuracy: 87.4, status: "active" as const, trades: 1034, shapleyWeight: 0.19 },
  { id: "cmaes", name: "CMA-ES", accuracy: 89.7, status: "active" as const, trades: 756, shapleyWeight: 0.28 },
  { id: "composite", name: "Composite Brain", accuracy: 91.4, status: "active" as const, trades: 2103, shapleyWeight: 1.0 },
];

export const strategies = [
  { id: "tri-arb", name: "Triangular Arbitrage", winRate: 87.2, category: "arbitrage", risk: "aggressive" },
  { id: "dca", name: "Dollar Cost Average", winRate: 72.3, category: "accumulation", risk: "conservative" },
  { id: "grid", name: "Grid Trading", winRate: 68.5, category: "range", risk: "balanced" },
  { id: "momentum", name: "Momentum", winRate: 64.7, category: "trend", risk: "aggressive" },
  { id: "mean-rev", name: "Mean Reversion", winRate: 66.1, category: "mean-reversion", risk: "balanced" },
  { id: "flash-arb", name: "Flash Loan Arb", winRate: 94.1, category: "arbitrage", risk: "aggressive" },
];

export const agents = [
  {
    id: "arb-hunter-01",
    name: "ARB Hunter Alpha",
    type: "arbitrage" as const,
    status: "running" as const,
    pnl: 12450.0,
    pnlPercent: 8.3,
    trades24h: 47,
    winRate: 89.2,
    engine: "Composite Brain",
    strategy: "Triangular Arbitrage",
    riskProfile: "Aggressive",
    kellyFraction: 0.34,
    chains: ["ethereum", "polygon", "arbitrum"],
  },
  {
    id: "flash-scout-02",
    name: "Flash Scout Beta",
    type: "flash_loan" as const,
    status: "running" as const,
    pnl: 8920.5,
    pnlPercent: 5.9,
    trades24h: 23,
    winRate: 94.1,
    engine: "Thompson Sampling",
    strategy: "Flash Loan Arb",
    riskProfile: "Aggressive",
    kellyFraction: 0.41,
    chains: ["ethereum", "bsc"],
  },
  {
    id: "grid-trader-03",
    name: "Grid Master Gamma",
    type: "dex_trading" as const,
    status: "paused" as const,
    pnl: -1250.0,
    pnlPercent: -2.1,
    trades24h: 0,
    winRate: 62.5,
    engine: "PPO Agent",
    strategy: "Grid Trading",
    riskProfile: "Balanced",
    kellyFraction: 0.18,
    chains: ["polygon"],
  },
  {
    id: "momentum-04",
    name: "Momentum Delta",
    type: "yield" as const,
    status: "running" as const,
    pnl: 5670.8,
    pnlPercent: 12.4,
    trades24h: 8,
    winRate: 87.5,
    engine: "CMA-ES",
    strategy: "Momentum",
    riskProfile: "Balanced",
    kellyFraction: 0.27,
    chains: ["ethereum", "avalanche"],
  },
];

export const flashLoanOpportunities = [
  {
    id: "fl-001",
    pair: "ETH/USDC",
    buyDex: "Uniswap V3",
    sellDex: "Curve",
    spread: 0.42,
    estimatedProfit: 1250.0,
    loanAmount: 500000,
    gasEstimate: 45.2,
    netProfit: 1204.8,
    chain: "ethereum",
    confidence: 94,
    expiresIn: 12,
    status: "live" as const,
    route: ["Aave V3", "Uniswap V3", "Curve", "Repay"],
  },
  {
    id: "fl-002",
    pair: "WBTC/ETH",
    buyDex: "SushiSwap",
    sellDex: "Balancer",
    spread: 0.38,
    estimatedProfit: 890.0,
    loanAmount: 350000,
    gasEstimate: 38.5,
    netProfit: 851.5,
    chain: "ethereum",
    confidence: 87,
    expiresIn: 8,
    status: "live" as const,
    route: ["Aave V3", "SushiSwap", "Balancer", "Repay"],
  },
  {
    id: "fl-003",
    pair: "MATIC/USDT",
    buyDex: "QuickSwap",
    sellDex: "Uniswap V3",
    spread: 0.55,
    estimatedProfit: 420.0,
    loanAmount: 200000,
    gasEstimate: 2.1,
    netProfit: 417.9,
    chain: "polygon",
    confidence: 91,
    expiresIn: 15,
    status: "live" as const,
    route: ["Aave V3", "QuickSwap", "Uniswap V3", "Repay"],
  },
  {
    id: "fl-004",
    pair: "ARB/ETH",
    buyDex: "Camelot",
    sellDex: "Uniswap V3",
    spread: 0.31,
    estimatedProfit: 680.0,
    loanAmount: 280000,
    gasEstimate: 5.8,
    netProfit: 674.2,
    chain: "arbitrum",
    confidence: 82,
    expiresIn: 6,
    status: "expiring" as const,
    route: ["Aave V3", "Camelot", "Uniswap V3", "Repay"],
  },
];

export const wallets = [
  {
    id: "w-eth-01",
    name: "Primary Ethereum",
    chain: "ethereum",
    address: "0x742d...F4a8",
    fullAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f2F4a8",
    balance: 42.85,
    balanceUsd: 128550.0,
    tokens: [
      { symbol: "ETH", amount: 42.85, valueUsd: 128550.0, change24h: 2.3 },
      { symbol: "USDC", amount: 45000.0, valueUsd: 45000.0, change24h: 0.01 },
      { symbol: "WBTC", amount: 1.25, valueUsd: 81250.0, change24h: -0.8 },
      { symbol: "LINK", amount: 500, valueUsd: 7500.0, change24h: 5.2 },
    ],
  },
  {
    id: "w-poly-01",
    name: "Polygon Trading",
    chain: "polygon",
    address: "0x8B3a...2C1b",
    fullAddress: "0x8B3a4F6d2e9A7c1b5E0D3f8A6B4c2E1d0F2C1b",
    balance: 125000.0,
    balanceUsd: 125000.0,
    tokens: [
      { symbol: "MATIC", amount: 50000, valueUsd: 45000.0, change24h: -1.2 },
      { symbol: "USDT", amount: 80000, valueUsd: 80000.0, change24h: 0.0 },
    ],
  },
  {
    id: "w-arb-01",
    name: "Arbitrum Ops",
    chain: "arbitrum",
    address: "0xA1B2...9E0f",
    fullAddress: "0xA1B2C3D4E5F6a7b8c9d0e1f2A3B4C5D6E7F89E0f",
    balance: 15.2,
    balanceUsd: 45600.0,
    tokens: [
      { symbol: "ETH", amount: 15.2, valueUsd: 45600.0, change24h: 2.3 },
      { symbol: "ARB", amount: 10000, valueUsd: 12000.0, change24h: 3.7 },
    ],
  },
];

export const recentTrades = [
  { id: "t1", pair: "ETH/USDC", type: "buy" as const, amount: 2.5, price: 3000.0, pnl: 450.0, time: "2m ago", strategy: "Triangular Arb" },
  { id: "t2", pair: "WBTC/ETH", type: "sell" as const, amount: 0.15, price: 65000.0, pnl: -120.0, time: "8m ago", strategy: "Mean Reversion" },
  { id: "t3", pair: "MATIC/USDT", type: "buy" as const, amount: 5000, price: 0.9, pnl: 230.0, time: "15m ago", strategy: "Flash Loan" },
  { id: "t4", pair: "ARB/ETH", type: "sell" as const, amount: 2000, price: 1.2, pnl: 180.0, time: "23m ago", strategy: "Momentum" },
  { id: "t5", pair: "LINK/USDC", type: "buy" as const, amount: 100, price: 15.0, pnl: 75.0, time: "31m ago", strategy: "Grid Trading" },
];

export const analyticsData = {
  totalPnl: 47892.5,
  totalTrades: 3847,
  winRate: 78.4,
  avgTradeSize: 12450.0,
  sharpeRatio: 2.14,
  maxDrawdown: -8.7,
  dailyVolume: 1250000,
  monthlyReturn: 12.8,
  byzantineConsensus: 0.92,
  kellyOptimal: 0.31,
};

export const userProfile = {
  name: "Darcel King",
  email: "darcel@jdl.trading",
  subscription: "pro" as const,
  kycVerified: true,
  joinDate: "2024-03-15",
  referralCode: "JDL-PRO-7X2K",
};

export const subscriptionTiers = [
  {
    id: "free",
    name: "Free",
    price: 0,
    currency: "AUD",
    features: ["1 AI Agent", "3 Basic Strategies", "1 Wallet", "Community Support"],
    limits: { agents: 1, wallets: 1, flashLoans: false, strategies: 3 },
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    currency: "AUD",
    features: ["5 AI Agents", "15 Strategies", "10 Wallets", "Flash Loans", "Priority Support", "All AI Engines", "6-Chain Support"],
    limits: { agents: 5, wallets: 10, flashLoans: true, strategies: 15 },
    current: true,
  },
  {
    id: "elite",
    name: "Elite",
    price: 299,
    currency: "AUD",
    features: ["Unlimited Agents", "Custom Strategies", "Unlimited Wallets", "Unlimited Flash Loans", "Priority Execution", "24/7 Dedicated Support", "API Access"],
    limits: { agents: -1, wallets: -1, flashLoans: true, strategies: -1 },
  },
];

export const portfolioHistory = {
  "7d": [
    { day: "Mon", value: 271200 },
    { day: "Tue", value: 275800 },
    { day: "Wed", value: 273400 },
    { day: "Thu", value: 278100 },
    { day: "Fri", value: 280600 },
    { day: "Sat", value: 282300 },
    { day: "Sun", value: 284750 },
  ],
  "30d": [
    { day: "W1", value: 248000 },
    { day: "W2", value: 255300 },
    { day: "W3", value: 261800 },
    { day: "W4", value: 270400 },
    { day: "W5", value: 278100 },
    { day: "Now", value: 284750 },
  ],
  "90d": [
    { day: "M1", value: 195000 },
    { day: "M2", value: 218400 },
    { day: "M3", value: 242700 },
    { day: "M4", value: 260100 },
    { day: "M5", value: 271500 },
    { day: "Now", value: 284750 },
  ],
};

export const portfolioStats = {
  "7d": { changePct: 4.57, changeAmt: 12450, sharpe: 2.14, label: "Weekly" },
  "30d": { changePct: 14.82, changeAmt: 36750, sharpe: 1.87, label: "Monthly" },
  "90d": { changePct: 46.03, changeAmt: 89750, sharpe: 2.31, label: "Quarterly" },
};

export const revenueBreakdown = [
  { source: "Arbitrage", amount: 18420, color: "#3b82f6", pct: 38 },
  { source: "Flash Loans", amount: 12890, color: "#8b5cf6", pct: 27 },
  { source: "Grid Trading", amount: 8650, color: "#22c55e", pct: 18 },
  { source: "Momentum", amount: 5240, color: "#f59e0b", pct: 11 },
  { source: "DCA", amount: 2692, color: "#06b6d4", pct: 6 },
];

export const agentRevenueHistory = [
  { hour: "6h", received: 120, sent: 40 },
  { hour: "5h", received: 85, sent: 60 },
  { hour: "4h", received: 210, sent: 30 },
  { hour: "3h", received: 145, sent: 90 },
  { hour: "2h", received: 180, sent: 50 },
  { hour: "1h", received: 95, sent: 70 },
  { hour: "Now", received: 160, sent: 45 },
];

export const walletActivityHistory = [
  { day: "Mon", txCount: 12, volume: 4200 },
  { day: "Tue", txCount: 18, volume: 6800 },
  { day: "Wed", txCount: 8, volume: 2400 },
  { day: "Thu", txCount: 24, volume: 9100 },
  { day: "Fri", txCount: 31, volume: 12600 },
  { day: "Sat", txCount: 15, volume: 5300 },
  { day: "Sun", txCount: 22, volume: 8700 },
];

export const networkGasData: Record<string, { gwei: number; speed: string; usdCost: number }> = {
  ethereum: { gwei: 28, speed: "~14s", usdCost: 4.20 },
  polygon: { gwei: 45, speed: "~2s", usdCost: 0.01 },
  arbitrum: { gwei: 0.1, speed: "~0.3s", usdCost: 0.12 },
  bsc: { gwei: 3, speed: "~3s", usdCost: 0.08 },
  avalanche: { gwei: 25, speed: "~2s", usdCost: 0.35 },
  optimism: { gwei: 0.05, speed: "~2s", usdCost: 0.08 },
};

export const chainIcons: Record<string, string> = {
  ethereum: "E",
  polygon: "P",
  arbitrum: "A",
  bsc: "B",
  avalanche: "V",
  optimism: "O",
};

export const chainColors: Record<string, string> = {
  ethereum: "#627eea",
  polygon: "#8247e5",
  arbitrum: "#28a0f0",
  bsc: "#f3ba2f",
  avalanche: "#e84142",
  optimism: "#ff0420",
};
