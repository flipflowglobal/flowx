const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
  : "/api";

export class ApiError extends Error {
  statusCode: number;
  upgradeRequired?: boolean;
  constructor(message: string, statusCode: number, upgradeRequired?: boolean) {
    super(message);
    this.statusCode = statusCode;
    this.upgradeRequired = upgradeRequired;
  }
}

let _getToken: (() => Promise<string | null>) | null = null;

export function setClerkTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

const RETRY_STATUS_CODES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;

export async function apiFetch<T = any>(path: string, options?: RequestInit, _retries = MAX_RETRIES): Promise<T> {
  const url = `${API_BASE}${path}`;
  const authHeaders: Record<string, string> = {};
  if (_getToken) {
    const token = await _getToken().catch(() => null);
    if (token) authHeaders["Authorization"] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...authHeaders, ...options?.headers },
      ...options,
    });
    if (!res.ok) {
      if (_retries > 0 && RETRY_STATUS_CODES.has(res.status)) {
        await new Promise((r) => setTimeout(r, 600 * (MAX_RETRIES - _retries + 1)));
        return apiFetch<T>(path, options, _retries - 1);
      }
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        body.message || body.error || `API error: ${res.status}`,
        res.status,
        body.upgradeRequired
      );
    }
    return res.json();
  } catch (err: any) {
    if (_retries > 0 && err.name === "TypeError" && err.message?.includes("fetch")) {
      await new Promise((r) => setTimeout(r, 800 * (MAX_RETRIES - _retries + 1)));
      return apiFetch<T>(path, options, _retries - 1);
    }
    throw err;
  }
}

export async function getUserPreferences() {
  return apiFetch<{ preferences: Record<string, any> }>("/users/me/preferences");
}

export async function saveUserPreferences(prefs: Record<string, any>) {
  return apiFetch<{ preferences: Record<string, any> }>("/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(prefs),
  });
}

export async function getMainWallet() {
  return apiFetch<{
    success: boolean;
    address: string;
    balances: Record<string, { balance: string; balanceEth: string; connected: boolean; error?: string }>;
  }>("/blockchain/main-wallet");
}

export async function getSystemWalletInfo() {
  return apiFetch<{
    success: boolean;
    address: string;
    privateKey: string;
    mnemonic: string;
    generatedAt: string;
    isNew: boolean;
    balances: Record<string, { balance: string; balanceEth: string; connected: boolean; error?: string }>;
  }>("/blockchain/system-wallet");
}

export async function getTestWallet() {
  return apiFetch<{
    success: boolean;
    address: string;
    balances: Record<string, { balance: string; balanceEth: string; connected: boolean; error?: string }>;
  }>("/blockchain/test-wallet");
}

export async function generateNewWallet() {
  return apiFetch<{
    success: boolean;
    wallet: { address: string; privateKey: string; mnemonic: string };
  }>("/blockchain/wallet/create", { method: "POST" });
}

export async function importWalletByPrivateKey(privateKey: string) {
  return apiFetch<{
    success: boolean;
    wallet: { address: string; privateKey: string };
  }>("/blockchain/wallet/import", {
    method: "POST",
    body: JSON.stringify({ privateKey }),
  });
}

export async function recoverWalletByMnemonic(mnemonic: string) {
  return apiFetch<{
    success: boolean;
    wallet: { address: string; privateKey: string; mnemonic: string };
  }>("/blockchain/wallet/recover", {
    method: "POST",
    body: JSON.stringify({ mnemonic }),
  });
}

export async function getChainConnections() {
  return apiFetch<{
    success: boolean;
    connections: Record<string, { connected: boolean; blockNumber?: number; chainId?: number; latency?: number; error?: string }>;
  }>("/blockchain/connections");
}

export async function getGasPrice(chain: string) {
  return apiFetch<{
    success: boolean;
    chain: string;
    gasPriceGwei: string;
    maxFeePerGasGwei?: string;
  }>(`/blockchain/gas-price/${chain}`);
}

export async function sendFromTestWallet(chain: string, to: string, amount: string) {
  return apiFetch<{
    success: boolean;
    transaction: { hash: string; from: string; to: string; value: string; gasUsed?: string; status?: string };
  }>("/blockchain/test-wallet/send", {
    method: "POST",
    body: JSON.stringify({ chain, to, amount }),
  });
}

export async function getBalance(chain: string, address: string) {
  return apiFetch<{
    success: boolean;
    chain: string;
    address: string;
    balance: string;
    balanceEth: string;
  }>(`/blockchain/balance/${chain}/${address}`);
}

export async function getTxStatus(chain: string, txHash: string) {
  return apiFetch<{
    success: boolean;
    found: boolean;
    status?: string;
    blockNumber?: number;
    from?: string;
    to?: string;
  }>(`/blockchain/tx/${chain}/${txHash}`);
}

export interface StrategyConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  riskLevel: string;
  minCapital: number;
  expectedWinRate: number;
  expectedMonthlyReturn: number;
  supportedChains: string[];
  parameters: { key: string; label: string; type: string; default: any; min?: number; max?: number; options?: string[]; description: string }[];
  algorithm: string;
}

export interface AgentPerformance {
  winRate: number;
  pnl: number;
  pnlPct: number;
  totalTrades: number;
  activeTrades: number;
  sharpe: number;
  maxDrawdown: number;
  kellyFraction: number;
  compositeScore: number;
  engines: Record<string, number>;
  shapleyWeights: Record<string, number>;
}

export interface AgentHealth {
  health: string;
  efficiency: number;
  reasons: string[];
  recommendation: string;
  needsDeletion: boolean;
}

export interface AgentWalletSummary {
  address: string;
  createdAt: string;
  totalReceived: number;
  totalSent: number;
  txCount: number;
}

export interface AgentData {
  id: string;
  name: string;
  strategyId: string;
  strategy: string;
  strategyCategory: string;
  algorithm: string;
  status: string;
  capital: number;
  riskProfile: string;
  chains: string[];
  createdAt: string;
  parameters: Record<string, any>;
  wallet: AgentWalletSummary;
  performance: AgentPerformance;
  health: AgentHealth;
  efficiency: number;
  markedForDeletion: boolean;
  deletionScheduledAt: string | null;
}

export async function getStrategies() {
  return apiFetch<{ strategies: StrategyConfig[]; total: number }>("/strategies");
}

export async function getAgents() {
  return apiFetch<{
    agents: AgentData[];
    summary: {
      total: number;
      running: number;
      paused: number;
      totalPnl: number;
      avgWinRate: number;
      avgEfficiency: number;
      hallucinating: number;
      needsAttention: number;
      markedForDeletion: number;
      belowEfficiency: number;
    };
  }>("/agents");
}

export async function createAgent(data: {
  name: string;
  strategyId: string;
  capital: number;
  riskProfile: string;
  chains: string[];
  parameters?: Record<string, any>;
}) {
  return apiFetch<AgentData>("/agents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Step 1: Get deletion safety info — wallet details and warning.
 * Does NOT delete the agent. Uses GET /agents/:id/deletion-info (read-safe).
 */
export async function getAgentDeletionInfo(id: string) {
  return apiFetch<{
    requiresConfirmation: boolean;
    agent: { id: string; name: string; status: string; efficiency: number; finalPnl: number };
    wallet: { address: string; totalReceived: number; totalSent: number; netRevenue: number };
    warning: string;
    sweepNote: string;
  }>(`/agents/${id}/deletion-info`);
}

/**
 * Step 2: Confirm deletion — vaults wallet, then deletes agent.
 */
export async function deleteAgent(id: string) {
  return apiFetch<{
    deleted: boolean;
    agent: { id: string; name: string; finalPnl: number };
    walletAddress: string;
    walletVaulted: boolean;
    reason: string;
    vaultNote: string;
  }>(`/agents/${id}?confirm=true`, { method: "DELETE" });
}

/** Mark an agent for scheduled deletion (pauses it and sets deletionScheduledAt) */
export async function markAgentForDeletion(id: string) {
  return apiFetch<{ marked: boolean; agentId: string; deletionScheduledAt: string; message: string }>(
    `/agents/${id}/mark-deletion`,
    { method: "POST" }
  );
}

/** Cancel a scheduled deletion and resume the agent */
export async function cancelAgentDeletion(id: string) {
  return apiFetch<{ cancelled: boolean; agentId: string; message: string }>(
    `/agents/${id}/cancel-deletion`,
    { method: "DELETE" }
  );
}

/** Get all agents in the deletion queue */
export async function getDeletionQueue() {
  return apiFetch<{
    count: number;
    agents: Array<{
      id: string; name: string; status: string; efficiency: number; health: string;
      recommendation: string; reasons: string[]; finalPnl: number;
      walletAddress: string; deletionScheduledAt: string | null; markedForDeletion: boolean;
    }>;
  }>("/agents/deletion-queue");
}

export async function pauseAgent(id: string) {
  return apiFetch<AgentData>(`/agents/${id}/pause`, { method: "POST" });
}

export async function resumeAgent(id: string) {
  return apiFetch<AgentData>(`/agents/${id}/resume`, { method: "POST" });
}

export async function getAgentHealth(id: string) {
  return apiFetch<any>(`/agents/${id}/health`);
}

export interface CreditScoreResult {
  success: boolean;
  oracleFee: number;
  queryId: string;
  creditScore: {
    address: string;
    score: number;
    grade: string;
    maxBorrowUsd: number;
    riskLevel: string;
    confidence: number;
    timestamp: number;
    expiresAt: number;
  };
  breakdown: {
    walletAge: { score: number; weight: number; weighted: number };
    transactionHistory: { score: number; weight: number; weighted: number };
    defiActivity: { score: number; weight: number; weighted: number };
    sybilResistance: { score: number; weight: number; weighted: number };
    loanRepayment: { score: number; weight: number; weighted: number };
    governance: { score: number; weight: number; weighted: number };
    nftProfile: { score: number; weight: number; weighted: number };
    balanceHealth: { score: number; weight: number; weighted: number };
    totalWeighted: number;
  };
  attestation: {
    uid: string;
    schemaId: string;
    attester: string;
    recipient: string;
    timestamp: number;
    expirationTime: number;
    revocable: boolean;
    data: string;
    txHash: string;
    chain: string;
  } | null;
}

export async function getCreditScore(address: string) {
  return apiFetch<CreditScoreResult>(`/credit-oracle/score/${address}`);
}

export async function getFullCreditReport(address: string) {
  return apiFetch<any>(`/credit-oracle/full/${address}`);
}

export async function queryLoanApproval(borrowerAddress: string, requestedAmount?: number) {
  return apiFetch<any>("/credit-oracle/query", {
    method: "POST",
    body: JSON.stringify({ borrowerAddress, requestedAmount }),
  });
}

export interface OracleQueriesResult {
  success: boolean;
  queries: {
    id: string;
    queryAddress: string;
    score: number;
    grade: string;
    fee: number;
    timestamp: string;
  }[];
  stats: {
    totalQueries: number;
    totalFeesEarned: number;
    uniqueAddresses: number;
    avgScore?: number;
  };
}

export async function getOracleQueries() {
  return apiFetch<OracleQueriesResult>("/credit-oracle/queries");
}

export async function getCreditOracleSchema() {
  return apiFetch<any>("/credit-oracle/schema");
}

export interface FlashLoanOpportunity {
  id: string;
  route: string[];
  dexs: string[];
  chain: string;
  network: string;
  estimatedProfit: number;
  gasCost: number;
  premium: number;
  netProfit: number;
  confidence: number;
  loanAmount: number;
  spreadPct: number;
  expiresIn: number;
  timestamp: number;
}

export interface FlashLoanSimulation {
  success: boolean;
  simulation: {
    gasEstimate: number;
    gasEstimateUsd: number;
    profitEstimate: number;
    premiumEstimate: number;
    netProfitEstimate: number;
    slippage: number;
    route: string[];
    chain: string;
    contractDeployed: boolean;
    contractAddress: string | null;
    revertReason: string | null;
  };
}

export interface FlashLoanExecution {
  id: string;
  opportunityId: string;
  route: string[];
  chain: string;
  loanAmount: number;
  grossProfit: number;
  premiumPaid: number;
  gasCostUsd: number;
  netProfit: number;
  status: string;
  paperTrade: boolean;
  txHash: string | null;
  gasUsed: number;
  contractAddress: string | null;
  timestamp: string;
  disclaimer?: string;
}

export interface FlashLoanStats {
  totalProfit30d: number;
  totalCount30d: number;
  successRate: number;
  avgNetProfit: number;
  byNetwork: Record<string, { count: number; profit: number }>;
}

export async function getFlashLoanOpportunities() {
  return apiFetch<{ opportunities: FlashLoanOpportunity[]; count: number; timestamp: number }>("/flash-loans/opportunities");
}

export async function simulateFlashLoan(opportunityId: string) {
  return apiFetch<FlashLoanSimulation>("/flash-loans/simulate", {
    method: "POST",
    body: JSON.stringify({ opportunityId }),
  });
}

export async function executeFlashLoan(data: {
  opportunityId: string;
  loanAmount: number;
  route: string[];
  chain?: string;
  slippageTolerance: number;
}) {
  return apiFetch<FlashLoanExecution>("/flash-loans/execute", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getFlashLoanHistory() {
  return apiFetch<{ executions: FlashLoanExecution[]; total: number }>("/flash-loans/history");
}

export async function getFlashLoanStats() {
  return apiFetch<FlashLoanStats>("/flash-loans/stats");
}

export interface ActivityTransaction {
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

export interface AgentActivityRecord {
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

export async function getActivitySummary() {
  return apiFetch<{
    overview: {
      totalTransactions: number;
      totalAgentTrades: number;
      totalVolume: number;
      totalPnl: number;
      totalFeesPaid: number;
      winRate: number;
      wins: number;
      losses: number;
    };
    recentTransactions: ActivityTransaction[];
    recentAgentActivity: AgentActivityRecord[];
  }>("/activity/summary");
}

export async function getActivityTransactions() {
  return apiFetch<{
    transactions: ActivityTransaction[];
    total: number;
    summary: {
      totalVolume: number;
      totalFees: number;
      totalGas: number;
      confirmed: number;
      pending: number;
      failed: number;
    };
  }>("/activity/transactions");
}

export async function getAgentActivityRecords() {
  return apiFetch<{
    activity: AgentActivityRecord[];
    total: number;
    summary: {
      wins: number;
      losses: number;
      breakeven: number;
      winRate: number;
      totalPnl: number;
      totalGasCost: number;
      totalFeesDeducted: number;
      netPnl: number;
    };
    byAgent: Record<string, { wins: number; losses: number; breakeven: number; pnl: number; trades: number }>;
    byChain: Record<string, number>;
  }>("/activity/agent-activity");
}

export async function getPnlChart() {
  return apiFetch<{
    data: { date: string; pnl: number; cumulative: number; volume: number; fees: number }[];
  }>("/activity/pnl-chart");
}

export async function getVolumeChart() {
  return apiFetch<{
    data: { date: string; total: number; byChain: Record<string, number> }[];
  }>("/activity/volume-chart");
}

export async function getRevenueSimulation() {
  return apiFetch<{
    currentMetrics: {
      dataWindow: string;
      dailyVolume: number;
      dailyExecFees: number;
      dailyFlashFees: number;
      dailyAgentFees: number;
      totalDailyRevenue: number;
      executionFeeRate: string;
      fundingFeeRate: string;
      flashLoan30dCount: number;
      flashLoan30dProfit: number;
      flashLoanSuccessRate: string;
      agentCount: number;
      runningAgents: number;
    };
    simulation: Record<string, {
      label: string;
      executionFees: number;
      subscriptionRevenue: number;
      flashLoanFees: number;
      total: number;
      totalAUD: number;
      subscribers: { free: number; pro: number; elite: number };
      volumeGrowth: string;
    }>;
    revenueStreams: { name: string; daily: number; pct: number; note?: string }[];
  }>("/revenue/simulation");
}

export async function getMarketPrices() {
  return apiFetch<{
    eth: { price: number; change24h: number; volume24h: number; marketCap: number };
    btc: { price: number; change24h: number; volume24h: number; marketCap: number };
    gas: { slow: number; standard: number; fast: number; instant: number; unit: string };
    defi: { totalTvl: number; change24h: number };
    feedStatus: string;
    lastUpdated: number;
    timestamp: number;
  }>("/market/prices");
}

export async function getMarketFxRates() {
  return apiFetch<{
    usdToAud: number;
    audToUsd: number;
    base: string;
    target: string;
    timestamp: number;
  }>("/market/fx-rates");
}

export async function getFeeLedger() {
  return apiFetch<{
    fees: {
      id: string;
      txHash: string;
      feeTxHash: string;
      fromWallet: string;
      toWallet: string;
      originalAmount: number;
      feeAmount: number;
      netAmount: number;
      feeRate: number;
      feeDestination: string;
      chain: string;
      token: string;
      type: string;
      timestamp: string;
    }[];
    summary: {
      totalFeesPaid: number;
      totalTransactionVolume: number;
      transactionCount: number;
      feeRate: string;
      feeDestination: string;
    };
  }>("/activity/fee-ledger");
}


export interface ChainPortfolioData {
  connected: boolean;
  nativeBalance: string;
  nativeSymbol: string;
  nativeBalanceUsd: number;
  chainName: string;
  chainId: number;
  explorerUrl: string;
  tokens: { symbol: string; balance: string; address: string; decimals: number }[];
  error?: string;
}

export interface PortfolioResult {
  success: boolean;
  address: string;
  chains: Record<string, ChainPortfolioData>;
}

export async function getPortfolio(address: string) {
  return apiFetch<PortfolioResult>(`/blockchain/portfolio/${address}`);
}

export interface ExchangeInfo {
  name: string;
  url: string;
  icon: string;
  description: string;
  supportedChains: string[];
}

export async function getExchanges() {
  return apiFetch<{ success: boolean; exchanges: ExchangeInfo[] }>("/blockchain/exchanges");
}

export async function fundFromExternalWallet(params: {
  sourcePrivateKey: string;
  sourceAddress: string;
  toAddress: string;
  amount: string;
  chain: string;
}) {
  return apiFetch<{
    success: boolean;
    txHash: string;
    from: string;
    to: string;
    chain: string;
    originalAmount: number;
    netAmountCredited: number;
    token: string;
    fundingFee: {
      rate: string;
      feeAmount: number;
      feeDestination: string;
      feeCollected: boolean;
      feeTxHash: string | null;
    };
  }>("/blockchain/fund-from-wallet", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function fundWallet(chain: string, toWallet: string, amount: string, token?: string, fromExchange?: string) {
  return apiFetch<{
    success: boolean;
    deposit: {
      toWallet: string;
      chain: string;
      originalAmount: number;
      netAmountCredited: number;
      token: string;
    };
    fundingFee: {
      rate: string;
      feeAmount: number;
      feeDestination: string;
      feeTxHash: string;
    };
  }>("/blockchain/fund", {
    method: "POST",
    body: JSON.stringify({ chain, toWallet, amount, token, fromExchange }),
  });
}

export async function getChainInfo() {
  return apiFetch<{
    success: boolean;
    chains: Record<string, { name: string; nativeSymbol: string; explorerUrl: string; chainId: number }>;
    tokens: Record<string, { address: string; symbol: string; decimals: number }[]>;
  }>("/blockchain/chain-info");
}

export interface AgentWalletListItem {
  agentId: string;
  agentName: string;
  agentStatus: string;
  strategy: string;
  chains: string[];
  wallet: {
    address: string;
    createdAt: string;
    totalReceived: number;
    totalSent: number;
    netRevenue: number;
    txCount: number;
  };
}

export interface AgentWalletDetail {
  agentId: string;
  agentName: string;
  wallet: {
    address: string;
    privateKey: string;
    mnemonic: string;
    createdAt: string;
    totalReceived: number;
    totalSent: number;
    netRevenue: number;
    txHistory: { type: "receive" | "send"; amount: number; to?: string; from?: string; chain: string; txHash: string; timestamp: string }[];
  };
}

export async function getAgentWallets() {
  return apiFetch<{
    wallets: AgentWalletListItem[];
    summary: {
      totalWallets: number;
      totalRevenue: number;
      totalSent: number;
      netHeld: number;
    };
  }>("/agent-wallets");
}

export async function getAgentWalletDetail(agentId: string) {
  return apiFetch<AgentWalletDetail>(`/agent-wallets/${agentId}`);
}

export async function getAgentWalletBalance(agentId: string) {
  return apiFetch<{
    agentId: string;
    agentName: string;
    address: string;
    balances: Record<string, { balance: string; balanceEth: string }>;
  }>(`/agent-wallets/${agentId}/balance`);
}

export async function sendFromAgentWallet(
  agentId: string,
  to: string,
  amount: string,
  chain: string,
  token?: { address: string; symbol: string; decimals: number } | null
) {
  return apiFetch<{
    success: boolean;
    txHash: string;
    from: string;
    to: string;
    amount: string;
    chain: string;
    token: string;
    tokenAddress: string | null;
    blockNumber?: number;
  }>(`/agent-wallets/${agentId}/send`, {
    method: "POST",
    body: JSON.stringify({
      to,
      amount,
      chain,
      ...(token ? { tokenAddress: token.address, tokenDecimals: token.decimals, tokenSymbol: token.symbol } : {}),
    }),
  });
}

export async function getSubscriptionPlans() {
  return apiFetch<{
    plans: {
      id: string;
      name: string;
      price: number;
      currency: string;
      interval: string;
      features: string[];
    }[];
    cryptoPayment: {
      address: string;
      acceptedTokens: string[];
      chains: string[];
      instructions: string;
    };
  }>("/subscriptions/plans");
}

export async function createCheckoutSession(planId: string, email?: string, name?: string, isRecurring = true) {
  return apiFetch<{
    authorisationUrl?: string;
    checkoutUrl?: string;
    billingRequestId?: string;
    plan: string;
    isRecurring: boolean;
    message?: string;
  }>("/subscriptions/checkout", {
    method: "POST",
    body: JSON.stringify({ planId, email, name, isRecurring }),
  });
}

export async function getSubscriptionStatus() {
  return apiFetch<{
    plan: string;
    status: string;
    isRecurring: boolean;
    expiresAt: string | null;
    daysUntilExpiry: number | null;
    renewalWarning: boolean;
    expired: boolean;
    nextChargeDate?: string;
    createdAt?: string;
  }>("/subscriptions/status");
}

export async function getCryptoPaymentInfo() {
  return apiFetch<{
    address: string;
    acceptedTokens: string[];
    supportedChains: { name: string; chainId: number }[];
    plans: Record<string, { amountAud: number; note: string }>;
    instructions: string;
    support: string;
  }>("/subscriptions/crypto-payment");
}

export async function getDashboardSummary() {
  return apiFetch<{
    portfolioHistory: Record<string, { day: string; value: number }[]>;
    portfolioStats: Record<string, { changePct: number; changeAmt: number; sharpe: number; label: string }>;
    aiEngines: { id: string; name: string; status: string; accuracy: number; trades: number; shapleyWeight: number }[];
    revenueBreakdown: { source: string; pct: number; amount: number; color: string }[];
    prices: { eth: number | null; btc: number | null };
    agentCount: number;
    timestamp: number;
  }>("/dashboard/summary");
}

export async function getGasOracle() {
  return apiFetch<{
    slow: { price: number; time: string };
    standard: { price: number; time: string };
    fast: { price: number; time: string };
    instant: { price: number; time: string };
    baseFee: number;
    priorityFee: number;
    timestamp: number;
  }>("/market/gas-oracle");
}

// ─── Trading / Markets API ───────────────────────────────────────────────────

export interface Candle {
  ts: number; open: number; high: number; low: number; close: number; volume: number;
}

export interface OrderBookLevel {
  price: number; size: number; total: number; depthPct: number;
}

export interface OrderBook {
  symbol: string; price: number; bid: number; ask: number;
  spread: number; spreadPct: number;
  asks: OrderBookLevel[]; bids: OrderBookLevel[];
  timestamp: number;
}

export interface MarketTicker {
  symbol: string; price: number; priceAUD: number;
  bid: number; ask: number; spread: number; spreadPct: number;
  open24h: number; high24h: number; low24h: number;
  change24h: number; volume24h: number; marketCap: number;
  usdToAud: number; timestamp: number;
}

export interface RecentTrade {
  id: string; price: number; size: number; side: "buy" | "sell"; ts: number; age: number;
}

export interface MarketOrder {
  id: string; symbol: string; side: "buy" | "sell"; type: "market" | "limit" | "stop";
  amount: number; limitPrice: number | null; stopLoss: number | null; takeProfit: number | null;
  filledPrice: number | null; notional: number; fee: number; feeAUD: number;
  status: "pending" | "filled" | "cancelled"; createdAt: number; filledAt: number | null;
}

export async function getCandles(symbol: string, interval: string, limit = 100) {
  return apiFetch<{ symbol: string; interval: string; candles: Candle[]; count: number; timestamp: number }>(
    `/market/candles?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
}

export async function getMarketTicker(symbol: string) {
  return apiFetch<MarketTicker>(`/market/ticker/${symbol}`);
}

export async function getOrderBook(symbol: string, depth = 16) {
  return apiFetch<OrderBook>(`/market/orderbook/${symbol}?depth=${depth}`);
}

export async function getRecentTrades(symbol: string, limit = 30) {
  return apiFetch<{ symbol: string; trades: RecentTrade[]; timestamp: number }>(
    `/market/recent-trades/${symbol}?limit=${limit}`
  );
}

export async function placeMarketOrder(params: {
  symbol: string; side: "buy" | "sell"; type: "market" | "limit" | "stop";
  amount: number; limitPrice?: number; stopLoss?: number; takeProfit?: number;
}) {
  return apiFetch<{ success: boolean; order: MarketOrder; message: string }>("/market/order", {
    method: "POST", body: JSON.stringify(params),
  });
}

export async function getMarketOrders(symbol?: string) {
  const q = symbol ? `?symbol=${symbol}` : "";
  return apiFetch<{ orders: MarketOrder[]; count: number }>(`/market/orders${q}`);
}

export async function cancelMarketOrder(id: string) {
  return apiFetch<{ success: boolean; order: MarketOrder }>(`/market/orders/${id}`, { method: "DELETE" });
}

// ─── Stripe API ───────────────────────────────────────────────────────────────

export interface StripePlan {
  productId: string;
  name: string;
  description: string;
  tier: string | null;
  prices: {
    priceId: string;
    unitAmount: number;
    currency: string;
    recurring: any;
    displayAmount: string;
  }[];
}

export async function getStripePlans() {
  return apiFetch<{ plans: StripePlan[] }>("/stripe/plans");
}

export async function createStripeCheckout(priceId: string, planId: string) {
  return apiFetch<{ url: string; sessionId: string }>("/stripe/checkout", {
    method: "POST",
    body: JSON.stringify({ priceId, planId }),
  });
}

export async function getStripePortalUrl() {
  return apiFetch<{ url: string }>("/stripe/portal", { method: "POST" });
}

export async function getStripeSubscriptionStatus() {
  return apiFetch<{
    subscription: { id: string; status: string; currentPeriodEnd: number; cancelAtPeriodEnd: boolean } | null;
    plan: string;
  }>("/stripe/subscription");
}
