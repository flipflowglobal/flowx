"""
scanner/opportunity_scorer.py
==============================
Monte Carlo profit simulation for arbitrage opportunity scoring.

Algorithm: 500-sample Monte Carlo simulation with Gaussian slippage perturbation.
Reference: Wintermute/Jump Trading methodology for marginal trade filtering.

For each sample k=1..500:
  1. Perturb each step rate: r̃ₖ = rᵢ * exp(εᵢ)  where εᵢ ~ N(0, σ²)
     σ = slippage_bps / 10000 / sqrt(3)  (1σ = one-third of slippage budget)
  2. Chain amounts: Aₙ = A₀ * ∏ r̃ₖᵢ
  3. net_profit = Aₙ - loan - premium - gas_cost

Report:
  expected_profit = E[net_profit]
  profit_std      = std(net_profit)
  profit_p10/p50/p90 = percentiles
  viable = P(net_profit > min_profit_usd) ≥ 0.90
  confidence = P(net_profit > 0)

Sandwich threat detection: routes touching threatened pools get 3× σ penalty.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_N_SAMPLES      = 500
_AAVE_PREMIUM   = 0.0005   # 0.05%
_MIN_VIABILITY  = 0.90     # P(profit > min) must exceed this


class OpportunityScorer:
    """
    Monte Carlo scorer for arbitrage routes.
    ARM64-safe: pure NumPy, no CUDA.
    """

    def __init__(self, price_fetcher, gas_oracle, config, mempool_watcher=None):
        self._pf     = price_fetcher
        self._gas    = gas_oracle
        self._config = config
        self._mw     = mempool_watcher

    # ── Score Route ───────────────────────────────────────────────────────────
    def score_route(
        self,
        route: list[dict],
        loan_amount_wei: int,
        eth_price_usd: float = 2500.0,
    ) -> dict:
        """
        Score a route via 500-sample Monte Carlo.

        Parameters
        ----------
        route           : list of step dicts from RouteFinder
        loan_amount_wei : flash loan size in WETH wei
        eth_price_usd   : current ETH/USD price for profit conversion

        Returns
        -------
        dict with full scoring breakdown.
        """
        if not route or loan_amount_wei <= 0:
            return self._empty_score(route, loan_amount_wei)

        slippage_sigma = (self._config.slippage_bps / 10000) / math.sqrt(3)

        # Retrieve base rates from route data
        rates = np.array([
            max(step.get("rate", 1.0), 1e-12) for step in route
        ], dtype=np.float64)

        # Check for sandwich threats — triple sigma for threatened pools
        if self._mw is not None:
            sigmas = []
            for step in route:
                pool = step.get("pool", "")
                mult = 3.0 if self._mw.pool_is_threatened(pool) else 1.0
                sigmas.append(slippage_sigma * mult)
            sigmas = np.array(sigmas)
        else:
            sigmas = np.full(len(rates), slippage_sigma)

        # ── Monte Carlo simulation ────────────────────────────────────────────
        # Shape: (N_SAMPLES, n_steps)
        # Perturb: r̃ₖᵢ = rᵢ * exp(εᵢ)   εᵢ ~ N(0, σᵢ²)
        eps     = np.random.randn(_N_SAMPLES, len(rates)) * sigmas[np.newaxis, :]
        r_tilde = rates[np.newaxis, :] * np.exp(eps)          # (500, n_steps)
        # Chain product: final_amount / loan_amount
        prod    = np.prod(r_tilde, axis=1)                     # (500,)
        final_amounts = loan_amount_wei * prod                 # (500,) in wei

        # Costs
        premium_wei  = int(loan_amount_wei * _AAVE_PREMIUM)
        gas_units    = self._gas.estimate_gas({
            "from": "0x0000000000000000000000000000000000000001",
            "to":   self._config.flash_receiver_address or "0x0000000000000000000000000000000000000001",
            "data": b"",
        })
        gas_cost_wei = gas_units * (self._gas.get_eip1559_fees()[0])
        total_cost_wei = loan_amount_wei + premium_wei + gas_cost_wei

        # Net profit distribution in wei
        net_profit_wei_samples = final_amounts - total_cost_wei   # (500,)

        # Convert to USD
        wei_per_eth = 1e18
        net_profit_usd_samples = (net_profit_wei_samples / wei_per_eth) * eth_price_usd

        # Statistics
        expected_usd = float(np.mean(net_profit_usd_samples))
        std_usd      = float(np.std(net_profit_usd_samples))
        p10          = float(np.percentile(net_profit_usd_samples, 10))
        p50          = float(np.percentile(net_profit_usd_samples, 50))
        p90          = float(np.percentile(net_profit_usd_samples, 90))

        p_positive      = float(np.mean(net_profit_usd_samples > 0))
        p_above_min     = float(np.mean(net_profit_usd_samples > self._config.min_profit_usd))
        viable          = p_above_min >= _MIN_VIABILITY

        # Route fingerprint for deduplication
        route_hash = hashlib.sha256(
            json.dumps([s.get("pool","") for s in route]).encode()
        ).hexdigest()[:16]

        gas_gwei = gas_cost_wei / gas_units / 1e9 if gas_units > 0 else 0.0

        return {
            "route":               route,
            "route_hash":          route_hash,
            "token_in":            route[0].get("token_in", ""),
            "loan_amount_wei":     loan_amount_wei,
            "expected_profit_usd": expected_usd,
            "profit_std_usd":      std_usd,
            "profit_p10_usd":      p10,
            "profit_p50_usd":      p50,
            "profit_p90_usd":      p90,
            "profit_probability":  p_positive,
            "viability_probability": p_above_min,
            "gas_estimate_gwei":   gas_gwei,
            "gas_cost_wei":        gas_cost_wei,
            "gas_cost_usd":        (gas_cost_wei / 1e18) * eth_price_usd,
            "premium_wei":         premium_wei,
            "net_profit_wei":      int(np.mean(net_profit_wei_samples)),
            "net_profit_usd":      expected_usd,
            "viable":              viable,
            "confidence":          p_positive,
            "chain_id":            self._config.active.chain_id,
        }

    def _empty_score(self, route, loan_amount_wei) -> dict:
        return {
            "route": route or [], "route_hash": "", "token_in": "",
            "loan_amount_wei": loan_amount_wei,
            "expected_profit_usd": 0.0, "profit_std_usd": 0.0,
            "profit_p10_usd": 0.0, "profit_p50_usd": 0.0, "profit_p90_usd": 0.0,
            "profit_probability": 0.0, "viability_probability": 0.0,
            "gas_estimate_gwei": 0.0, "gas_cost_wei": 0, "gas_cost_usd": 0.0,
            "premium_wei": 0, "net_profit_wei": 0, "net_profit_usd": 0.0,
            "viable": False, "confidence": 0.0, "chain_id": 1,
        }
