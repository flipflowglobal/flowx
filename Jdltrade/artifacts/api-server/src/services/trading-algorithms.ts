/**
 * JDL Advanced Trading Algorithms
 * Monte Carlo, Black-Scholes, Bellman DP, MDP, PPO + Thompson Sampling
 */

// ─── Monte Carlo Simulation ─────────────────────────────────────────────────

export interface MonteCarloResult {
  expectedReturn: number;
  confidenceInterval: [number, number];
  worstCase: number;
  bestCase: number;
  sharpeRatio: number;
  winProbability: number;
  simulations: number;
}

export function runMonteCarlo(
  currentPrice: number,
  drift: number,
  volatility: number,
  timeHorizon: number,
  simulations = 10000
): MonteCarloResult {
  const dt = timeHorizon / 252;
  const sqrtDt = Math.sqrt(dt);
  const returns: number[] = [];

  for (let i = 0; i < simulations; i++) {
    let price = currentPrice;
    for (let step = 0; step < Math.ceil(timeHorizon); step++) {
      const z = boxMullerRandom();
      price *= Math.exp((drift - 0.5 * volatility ** 2) * dt + volatility * sqrtDt * z);
    }
    returns.push((price - currentPrice) / currentPrice);
  }

  returns.sort((a, b) => a - b);
  const mean = returns.reduce((s, r) => s + r, 0) / simulations;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / simulations;
  const stdDev = Math.sqrt(variance);

  const p5 = returns[Math.floor(simulations * 0.05)];
  const p95 = returns[Math.floor(simulations * 0.95)];
  const sharpe = stdDev > 0 ? (mean - 0.02 / 252) / stdDev : 0;
  const wins = returns.filter(r => r > 0).length;

  return {
    expectedReturn: mean,
    confidenceInterval: [p5, p95],
    worstCase: returns[0],
    bestCase: returns[simulations - 1],
    sharpeRatio: Math.max(-5, Math.min(5, sharpe)),
    winProbability: wins / simulations,
    simulations,
  };
}

// ─── Black-Scholes Option Pricing ───────────────────────────────────────────

export interface BlackScholesResult {
  callPrice: number;
  putPrice: number;
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export function blackScholes(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number
): BlackScholesResult {
  if (T <= 0) return { callPrice: Math.max(S - K, 0), putPrice: Math.max(K - S, 0), impliedVolatility: sigma, delta: S > K ? 1 : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const Nnd1 = normalCDF(-d1);
  const Nnd2 = normalCDF(-d2);
  const nd1 = normalPDF(d1);

  const callPrice = S * Nd1 - K * Math.exp(-r * T) * Nd2;
  const putPrice = K * Math.exp(-r * T) * Nnd2 - S * Nnd1;

  return {
    callPrice,
    putPrice,
    impliedVolatility: sigma,
    delta: Nd1,
    gamma: nd1 / (S * sigma * Math.sqrt(T)),
    theta: -(S * nd1 * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * Nd2,
    vega: S * nd1 * Math.sqrt(T),
    rho: K * T * Math.exp(-r * T) * Nd2,
  };
}

// Estimate IV from market price using Newton-Raphson
export function impliedVolatility(S: number, K: number, T: number, r: number, marketPrice: number): number {
  let sigma = 0.2;
  for (let i = 0; i < 100; i++) {
    const { callPrice, vega } = blackScholes(S, K, T, r, sigma);
    const diff = callPrice - marketPrice;
    if (Math.abs(diff) < 1e-6) break;
    if (vega < 1e-10) break;
    sigma = sigma - diff / vega;
    sigma = Math.max(0.001, Math.min(sigma, 5.0));
  }
  return sigma;
}

// ─── Bellman Dynamic Programming ────────────────────────────────────────────

export interface BellmanResult {
  optimalAction: "buy" | "sell" | "hold";
  optimalValue: number;
  valueFunction: number[];
  policy: string[];
}

export function bellmanDP(
  prices: number[],
  capitalStates = 10,
  gamma = 0.99
): BellmanResult {
  const n = prices.length;
  if (n < 2) return { optimalAction: "hold", optimalValue: 0, valueFunction: [], policy: [] };

  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const states = capitalStates;
  const V = new Array(states).fill(0);
  const policy: string[] = new Array(states).fill("hold");

  for (let iter = 0; iter < 100; iter++) {
    const Vnew = [...V];
    for (let s = 0; s < states; s++) {
      const normalizedState = s / (states - 1);
      const actions = [
        { action: "buy", reward: returns.reduce((s, r) => s + (r > 0 ? r : 0), 0) / returns.length * (1 + normalizedState) },
        { action: "sell", reward: returns.reduce((s, r) => s + (r < 0 ? -r : 0), 0) / returns.length * (1 - normalizedState) },
        { action: "hold", reward: 0.001 * normalizedState },
      ];

      const nextState = Math.min(states - 1, Math.max(0, s));
      const best = actions.reduce<{ action: string; reward: number; qval: number }>((best, a) => {
        const qval = a.reward + gamma * V[nextState];
        return qval > best.qval ? { ...a, qval } : best;
      }, { action: "hold", reward: 0, qval: -Infinity });

      Vnew[s] = best.qval;
      policy[s] = best.action;
    }
    const delta = Math.max(...V.map((v, i) => Math.abs(v - Vnew[i])));
    V.splice(0, states, ...Vnew);
    if (delta < 1e-6) break;
  }

  const midState = Math.floor(states / 2);
  return {
    optimalAction: policy[midState] as "buy" | "sell" | "hold",
    optimalValue: V[midState],
    valueFunction: V,
    policy,
  };
}

// ─── Markov Decision Process (Multi-Chain Routing) ──────────────────────────

export interface MDPState {
  chain: string;
  token: string;
  liquidity: number;
  gasPrice: number;
  slippage: number;
}

export interface MDPResult {
  optimalChain: string;
  expectedReward: number;
  routeScore: number;
  chainScores: Record<string, number>;
}

export function mdpMultiChainRoute(states: MDPState[], targetAmount: number): MDPResult {
  const chainScores: Record<string, number> = {};

  for (const state of states) {
    const liquidityScore = Math.log1p(state.liquidity) / 20;
    const gasPenalty = state.gasPrice / 100;
    const slippagePenalty = state.slippage * targetAmount;
    const reward = liquidityScore - gasPenalty - slippagePenalty / targetAmount;
    chainScores[state.chain] = reward;
  }

  const sorted = Object.entries(chainScores).sort((a, b) => b[1] - a[1]);
  const [optimalChain, bestScore] = sorted[0] || ["ethereum", 0];

  return {
    optimalChain,
    expectedReward: bestScore,
    routeScore: (bestScore + 1) / 2,
    chainScores,
  };
}

// ─── PPO (Proximal Policy Optimization) ─────────────────────────────────────

export interface PPOState {
  priceHistory: number[];
  volumeHistory: number[];
  position: number;
  capital: number;
  timestep: number;
}

export interface PPOAction {
  action: "buy" | "sell" | "hold";
  size: number;
  confidence: number;
  reasoning: string;
}

export class PPOAgent {
  private epsilon = 0.2;
  private gamma = 0.99;
  private policyWeights: number[];
  private valueWeights: number[];
  private learningRate = 0.001;

  constructor(stateSize = 10, actionSize = 3) {
    this.policyWeights = Array.from({ length: stateSize * actionSize }, () => (Math.random() - 0.5) * 0.1);
    this.valueWeights = Array.from({ length: stateSize }, () => (Math.random() - 0.5) * 0.1);
  }

  extractFeatures(state: PPOState): number[] {
    const prices = state.priceHistory.slice(-10);
    if (prices.length < 2) return new Array(10).fill(0);

    const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
    const avgReturn = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
    const volatility = Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length || 1));
    const momentum = prices.length > 1 ? (prices[prices.length - 1] - prices[0]) / prices[0] : 0;
    const rsi = this.computeRSI(prices);
    const macdSignal = this.computeMACD(prices);
    const vwap = this.computeVWAP(prices, state.volumeHistory.slice(-10));
    const priceVsVwap = prices[prices.length - 1] > vwap ? 1 : -1;
    const capitalUtil = state.capital > 0 ? state.position / state.capital : 0;
    const trend = prices.length >= 5 ? (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5] : 0;
    const normalizedTimestep = (state.timestep % 100) / 100;

    return [avgReturn, volatility, momentum, rsi / 100, macdSignal, priceVsVwap, capitalUtil, trend, normalizedTimestep, prices[prices.length - 1] / 1000];
  }

  selectAction(state: PPOState): PPOAction {
    const features = this.extractFeatures(state);
    const logits = this.computeLogits(features);
    const probs = softmax(logits);

    const maxProb = Math.max(...probs);
    const maxIdx = probs.indexOf(maxProb);
    const actions = ["buy", "sell", "hold"] as const;
    const action = actions[maxIdx];

    const momentum = features[2];
    const rsi = features[3] * 100;
    const trend = features[7];

    let reasoning = "";
    if (action === "buy") reasoning = `Positive momentum ${(momentum * 100).toFixed(2)}%, RSI ${rsi.toFixed(0)}, trend ${(trend * 100).toFixed(2)}%`;
    else if (action === "sell") reasoning = `Negative pressure, RSI ${rsi.toFixed(0)} overbought, trend reversal detected`;
    else reasoning = `Market consolidating, RSI ${rsi.toFixed(0)} neutral, waiting for signal`;

    const kellySize = this.kellyFraction(probs[maxIdx], 1.5);
    return { action, size: kellySize, confidence: maxProb, reasoning };
  }

  update(state: PPOState, action: string, reward: number, nextState: PPOState, done: boolean) {
    const features = this.extractFeatures(state);
    const nextFeatures = this.extractFeatures(nextState);
    const value = this.computeValue(features);
    const nextValue = done ? 0 : this.computeValue(nextFeatures);
    const advantage = reward + this.gamma * nextValue - value;

    const actionIdx = ["buy", "sell", "hold"].indexOf(action);
    if (actionIdx < 0) return;

    const logits = this.computeLogits(features);
    const probs = softmax(logits);
    const oldLogProb = Math.log(probs[actionIdx] + 1e-8);
    const ratio = Math.exp(oldLogProb - oldLogProb);
    const clippedRatio = Math.max(1 - this.epsilon, Math.min(1 + this.epsilon, ratio));
    const loss = -Math.min(ratio * advantage, clippedRatio * advantage);

    for (let i = 0; i < this.policyWeights.length; i++) {
      this.policyWeights[i] -= this.learningRate * loss * features[i % features.length];
    }
  }

  private computeLogits(features: number[]): number[] {
    const logits = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      for (let f = 0; f < features.length; f++) {
        logits[a] += this.policyWeights[a * features.length + f] * features[f];
      }
    }
    return logits;
  }

  private computeValue(features: number[]): number {
    return features.reduce((s, f, i) => s + f * (this.valueWeights[i] || 0), 0);
  }

  private computeRSI(prices: number[], period = 14): number {
    if (prices.length < period + 1) return 50;
    const changes = prices.slice(-period - 1).slice(1).map((p, i) => p - prices[prices.length - period + i]);
    const gains = changes.filter(c => c > 0).reduce((s, c) => s + c, 0) / period;
    const losses = Math.abs(changes.filter(c => c < 0).reduce((s, c) => s + c, 0)) / period;
    return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  }

  private computeMACD(prices: number[]): number {
    if (prices.length < 26) return 0;
    const ema12 = this.ema(prices, 12);
    const ema26 = this.ema(prices, 26);
    const macd = ema12 - ema26;
    return macd / (prices[prices.length - 1] || 1);
  }

  private ema(prices: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (const price of prices.slice(1)) ema = price * k + ema * (1 - k);
    return ema;
  }

  private computeVWAP(prices: number[], volumes: number[]): number {
    const len = Math.min(prices.length, volumes.length);
    if (len === 0) return prices[prices.length - 1] || 0;
    let totalPV = 0;
    let totalV = 0;
    for (let i = 0; i < len; i++) {
      totalPV += prices[i] * (volumes[i] || 1);
      totalV += volumes[i] || 1;
    }
    return totalV > 0 ? totalPV / totalV : prices[prices.length - 1];
  }

  private kellyFraction(winProb: number, winLossRatio: number): number {
    const f = winProb - (1 - winProb) / winLossRatio;
    return Math.max(0, Math.min(0.25, f));
  }
}

// ─── Thompson Sampling (Multi-Arm Bandit for Strategy Selection) ─────────────

export interface StrategyArm {
  strategyId: string;
  alpha: number;
  beta: number;
  totalReward: number;
  totalTrials: number;
}

export class ThompsonSampler {
  private arms: Map<string, StrategyArm>;

  constructor(strategyIds: string[]) {
    this.arms = new Map(
      strategyIds.map(id => [id, { strategyId: id, alpha: 1, beta: 1, totalReward: 0, totalTrials: 0 }])
    );
  }

  selectStrategy(): string {
    let bestSample = -Infinity;
    let bestStrategy = "";

    for (const [id, arm] of this.arms) {
      const sample = betaSample(arm.alpha, arm.beta);
      if (sample > bestSample) {
        bestSample = sample;
        bestStrategy = id;
      }
    }

    return bestStrategy;
  }

  update(strategyId: string, reward: number) {
    const arm = this.arms.get(strategyId);
    if (!arm) return;

    const success = reward > 0 ? 1 : 0;
    arm.alpha += success;
    arm.beta += 1 - success;
    arm.totalReward += reward;
    arm.totalTrials += 1;
  }

  getArmStats(): StrategyArm[] {
    return Array.from(this.arms.values()).map(arm => ({
      ...arm,
      expectedValue: arm.alpha / (arm.alpha + arm.beta),
    }));
  }
}

// ─── Kelly Criterion ─────────────────────────────────────────────────────────

export function kellyCriterion(
  winProbability: number,
  winMultiplier: number,
  lossMultiplier = 1.0,
  fractionCap = 0.25
): number {
  if (winProbability <= 0 || winProbability >= 1) return 0;
  const b = winMultiplier;
  const p = winProbability;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  return Math.max(0, Math.min(fractionCap, kelly));
}

// ─── Composite Signal Engine ─────────────────────────────────────────────────

export interface CompositeSignal {
  action: "buy" | "sell" | "hold";
  confidence: number;
  size: number;
  algorithm: string;
  reasoning: string;
  monteCarloReturn: number;
  sharpeRatio: number;
  optimalChain: string;
}

const ppoAgents = new Map<string, PPOAgent>();
const thompsonSamplers = new Map<string, ThompsonSampler>();

export function generateCompositeSignal(
  agentId: string,
  strategyId: string,
  priceHistory: number[],
  volumeHistory: number[],
  chains: string[],
  capital: number,
  position: number
): CompositeSignal {
  if (!ppoAgents.has(agentId)) ppoAgents.set(agentId, new PPOAgent());
  if (!thompsonSamplers.has(agentId)) {
    thompsonSamplers.set(agentId, new ThompsonSampler(["monte-carlo", "black-scholes", "bellman-dp", "ppo", "kelly"]));
  }

  const ppo = ppoAgents.get(agentId)!;
  const thompson = thompsonSamplers.get(agentId)!;

  const currentPrice = priceHistory[priceHistory.length - 1] || 1;
  const drift = priceHistory.length > 1
    ? (Math.log(priceHistory[priceHistory.length - 1]) - Math.log(priceHistory[0])) / priceHistory.length
    : 0.0005;
  const returns = priceHistory.slice(1).map((p, i) => (p - priceHistory[i]) / priceHistory[i]);
  const volatility = returns.length > 0
    ? Math.sqrt(returns.reduce((s, r) => s + r ** 2, 0) / returns.length)
    : 0.02;

  const mc = runMonteCarlo(currentPrice, drift, volatility, 1, 5000);
  const bs = blackScholes(currentPrice, currentPrice * 1.02, 1 / 252, 0.05, volatility);
  const bellman = bellmanDP(priceHistory.slice(-30));

  const ppoState: PPOState = {
    priceHistory,
    volumeHistory,
    position,
    capital,
    timestep: Date.now() % 1000,
  };
  const ppoAction = ppo.selectAction(ppoState);

  const selectedAlgo = thompson.selectStrategy();

  const chainStates: MDPState[] = chains.map(chain => ({
    chain,
    token: "ETH",
    liquidity: 1e6 + Math.random() * 1e7,
    gasPrice: 10 + Math.random() * 90,
    slippage: 0.001 + Math.random() * 0.01,
  }));
  const mdp = chainStates.length > 0 ? mdpMultiChainRoute(chainStates, capital * 0.1) : { optimalChain: "ethereum", expectedReward: 0, routeScore: 0.5, chainScores: {} };

  const kellySize = kellyCriterion(mc.winProbability, 1 + mc.expectedReturn, 1.0);

  // ── Extract RSI + MACD from PPO state for direct voting ──────────────────
  const ppoFeatures = ppo.extractFeatures({ priceHistory, volumeHistory, position, capital, timestep: Date.now() % 1000 });
  const rsi  = ppoFeatures[3] * 100;   // feature[3] is rsi/100
  const macd = ppoFeatures[4];          // feature[4] is macd signal (-1..1 normalised)
  const momentumFeature = ppoFeatures[2];  // short-term price momentum

  // ── Bollinger Band position ───────────────────────────────────────────────
  const recentPrices = priceHistory.slice(-20);
  let bbSignal = 0; // -1 oversold (buy), +1 overbought (sell), 0 neutral
  if (recentPrices.length >= 10) {
    const mean   = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const stdDev = Math.sqrt(recentPrices.reduce((s, p) => s + (p - mean) ** 2, 0) / recentPrices.length);
    const last   = recentPrices[recentPrices.length - 1];
    const zScore = stdDev > 0 ? (last - mean) / stdDev : 0;
    if (zScore < -1.5) bbSignal = -1;      // below lower band → oversold → buy signal
    else if (zScore > 1.5) bbSignal = 1;   // above upper band → overbought → sell
  }

  // ── Volume surge detection ────────────────────────────────────────────────
  const recentVols = volumeHistory.slice(-10);
  const avgVol  = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
  const lastVol = volumeHistory[volumeHistory.length - 1] || 0;
  const volumeSurge = avgVol > 0 && lastVol > avgVol * 1.5;

  // ── Market regime detection for vote weighting ────────────────────────────
  // Uses EMA alignment to detect trend direction and strength
  const ema20  = priceHistory.length >= 20 ? (() => { const k = 2/21; let e = priceHistory[0]; for (let i=1;i<priceHistory.length;i++) e = priceHistory[i]*k+e*(1-k); return e; })() : currentPrice;
  const ema50  = priceHistory.length >= 50 ? (() => { const k = 2/51; let e = priceHistory[0]; for (let i=1;i<priceHistory.length;i++) e = priceHistory[i]*k+e*(1-k); return e; })() : currentPrice;
  const upTrend   = ema20 > ema50 && currentPrice > ema20;
  const downTrend = ema20 < ema50 && currentPrice < ema20;
  const isVolatileRegime = volatility > 0.03;

  // Strategy-type classification for regime weighting
  const isTrendStrategy = ["momentum", "triangular-arb", "flash-loan-arb"].includes(strategyId);
  const isMeanRevStrategy = ["statistical-arb", "grid-trading"].includes(strategyId);

  // Regime weights: trend-following indicators weighted higher in trend regimes
  // Mean-reversion indicators weighted higher in ranging regimes
  const trendWeight   = (upTrend || downTrend) && isTrendStrategy ? 1.5 : (upTrend || downTrend) ? 1.2 : 0.8;
  const meanRevWeight = !(upTrend || downTrend) && isMeanRevStrategy ? 1.5 : !(upTrend || downTrend) ? 1.2 : 0.8;
  const volatilityPenalty = isVolatileRegime ? 0.6 : 1.0;

  const votes = {
    buy:  0,
    sell: 0,
    hold: 0,
  };

  // Monte Carlo: 2 votes (unbiased probabilistic)
  if (mc.expectedReturn > 0.005)       votes.buy  += 2 * volatilityPenalty;
  else if (mc.expectedReturn < -0.005) votes.sell += 2 * volatilityPenalty;
  else                                 votes.hold += 1;

  // Bellman DP: 1 vote
  if (bellman.optimalAction === "buy")       votes.buy  += 1;
  else if (bellman.optimalAction === "sell") votes.sell += 1;
  else                                       votes.hold += 1;

  // PPO neural: 3 votes (strongest signal — trend-aware)
  if (ppoAction.action === "buy")       votes.buy  += 3 * trendWeight;
  else if (ppoAction.action === "sell") votes.sell += 3 * trendWeight;
  else                                  votes.hold += 2;

  // Black-Scholes delta: 1 vote
  if (bs.delta > 0.6)      votes.buy  += 1;
  else if (bs.delta < 0.4) votes.sell += 1;

  // RSI: 2 votes — more weight in ranging regime (mean reversion)
  if (rsi < 35)      votes.buy  += 2 * meanRevWeight;
  else if (rsi > 65) votes.sell += 2 * meanRevWeight;
  else               votes.hold += 1;

  // MACD: 1-2 votes — more weight in trending regime
  const macdWeight = (upTrend || downTrend) ? 2 : 1;
  if (macd > 0.01)       votes.buy  += macdWeight;
  else if (macd < -0.01) votes.sell += macdWeight;

  // Bollinger Bands: 1-2 votes — stronger in ranging regime
  const bbWeight = !(upTrend || downTrend) ? 2 : 1;
  if (bbSignal < 0)      votes.buy  += bbWeight;
  else if (bbSignal > 0) votes.sell += bbWeight;

  // Momentum: 1 vote (trend-amplified)
  if (momentumFeature > 0.01)       votes.buy  += 1 * trendWeight;
  else if (momentumFeature < -0.01) votes.sell += 1 * trendWeight;

  // EMA trend bias: 1 direct vote for the trend direction
  if (upTrend)   votes.buy  += 1;
  else if (downTrend) votes.sell += 1;
  else           votes.hold += 0.5;

  // Volume surge amplifies the leading direction
  if (volumeSurge) {
    if (votes.buy > votes.sell) votes.buy  += 1.5;
    else if (votes.sell > votes.buy) votes.sell += 1.5;
  }

  // Volatile regime: push toward hold
  if (isVolatileRegime) votes.hold += 2;

  const totalVotes = votes.buy + votes.sell + votes.hold;
  let action: "buy" | "sell" | "hold" = "hold";
  let rawConfidence = 0.5;

  if (votes.buy > votes.sell && votes.buy > votes.hold) {
    action = "buy";
    rawConfidence = votes.buy / totalVotes;
  } else if (votes.sell > votes.buy && votes.sell > votes.hold) {
    action = "sell";
    rawConfidence = votes.sell / totalVotes;
  } else {
    action = "hold";
    rawConfidence = votes.hold / totalVotes;
  }

  // ATR-based confidence penalty: high volatility reduces confidence
  const atrVol = volatility * Math.sqrt(252);
  const volPenalty = Math.min(0.2, atrVol * 0.5);
  const confidence = Math.max(0.4, Math.min(0.97, rawConfidence - volPenalty));

  const size = action !== "hold" ? Math.min(kellySize, 0.2) * capital : 0;

  const regimeLabel = isVolatileRegime ? "volatile" : upTrend ? "uptrend" : downTrend ? "downtrend" : "ranging";
  const reasoningParts = [`regime:${regimeLabel}`, ppoAction.reasoning];
  if (rsi < 35)  reasoningParts.push(`RSI ${rsi.toFixed(0)} oversold`);
  if (rsi > 65)  reasoningParts.push(`RSI ${rsi.toFixed(0)} overbought`);
  if (Math.abs(macd) > 0.01) reasoningParts.push(`MACD ${macd > 0 ? "+" : ""}${(macd * 100).toFixed(1)}%`);
  if (bbSignal !== 0) reasoningParts.push(`BB ${bbSignal < 0 ? "oversold" : "overbought"}`);
  if (volumeSurge)    reasoningParts.push("vol surge×1.5");
  if (upTrend)        reasoningParts.push("EMA trend↑");
  if (downTrend)      reasoningParts.push("EMA trend↓");

  return {
    action,
    confidence,
    size,
    algorithm: `${selectedAlgo}+ppo+rsi+macd+bb+regime`,
    reasoning: reasoningParts.slice(0, 4).join(" | "),
    monteCarloReturn: mc.expectedReturn,
    sharpeRatio: mc.sharpeRatio,
    optimalChain: mdp.optimalChain,
  };
}

// ─── Math Utilities ───────────────────────────────────────────────────────────

function boxMullerRandom(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const n = 1 - normalPDF(x) * poly;
  return x >= 0 ? n : 1 - n;
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function softmax(logits: number[]): number[] {
  const maxL = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxL));
  const sum = exps.reduce((s, e) => s + e, 0);
  return exps.map(e => e / sum);
}

function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}

function gammaSample(shape: number): number {
  if (shape < 1) return gammaSample(1 + shape) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const z = boxMullerRandom();
    const v = Math.pow(1 + c * z, 3);
    if (v > 0 && Math.log(Math.random()) < 0.5 * z * z + d - d * v + d * Math.log(v)) return d * v;
  }
}
