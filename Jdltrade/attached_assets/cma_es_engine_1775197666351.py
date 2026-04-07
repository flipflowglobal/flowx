"""
ai/cma_es_engine.py
===================
Covariance Matrix Adaptation Evolution Strategy (CMA-ES).

Reference: Hansen & Ostermeier "Completely Derandomized Self-Adaptation in
           Evolution Strategies" (2001). BBOB benchmark winner across all
           2–40 dimensional non-convex continuous problems.

Why CMA-ES over simple GA:
  GA uses independent per-gene Gaussian mutation — ignores parameter
  correlations. CMA-ES adapts the full n×n covariance matrix C of the
  search distribution, effectively learning the local problem geometry.
  Convergence: O(n log n) function evaluations vs O(n²) for simple GA.

Parameters (θ ∈ ℝ^6):
  0: loan_fraction      ∈ [0.05, 0.80]   (fraction of max_loan)
  1: slippage_bps       ∈ [10, 200]
  2: min_profit_usd     ∈ [1.0, 50.0]
  3: scan_interval_ms   ∈ [200, 2000]
  4: gas_premium_factor ∈ [1.0, 3.0]     (multiplier on base fee tip)
  5: max_hops           ∈ [2, 5]

Fitness: Sharpe ratio of net_profit over last 200 trades
  Sharpe = μ / σ * √(trades_per_day)
  Using Sharpe prevents optimising toward high-variance low-probability wins.

CMA-ES update equations (standard, λ offspring):
  m_{g+1}  = m_g + c_m Σ_i w_i (x_{i:λ} - m_g)
  p_σ      = (1-c_σ)p_σ + √(c_σ(2-c_σ)μ_eff) C^{-½}(m_{g+1}-m_g)/σ
  p_c      = (1-c_c)p_c + h_σ √(c_c(2-c_c)μ_eff)(m_{g+1}-m_g)/σ
  C_{g+1}  = (1-c_1-c_μ)C + c_1 p_c p_cᵀ + c_μ Σ wᵢ yᵢ:λ yᵢ:λᵀ
  σ_{g+1}  = σ exp(c_σ/d_σ (‖p_σ‖/E‖N(0,I)‖ − 1))
"""

from __future__ import annotations

import logging
import math
import statistics
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_N_PARAMS = 6
_LAMBDA   = 10   # offspring count
_MU       = _LAMBDA // 2

# Parameter bounds [lo, hi]
_BOUNDS = np.array([
    [0.05, 0.80],   # loan_fraction
    [10,   200 ],   # slippage_bps
    [1.0,  50.0],   # min_profit_usd
    [200,  2000],   # scan_interval_ms
    [1.0,  3.0 ],   # gas_premium_factor
    [2,    5   ],   # max_hops
])

# Parameter names for human-readable output
_PARAM_NAMES = [
    "loan_fraction", "slippage_bps", "min_profit_usd",
    "scan_interval_ms", "gas_premium_factor", "max_hops",
]

# Default starting point (center of bounds)
_M_INIT = (_BOUNDS[:, 0] + _BOUNDS[:, 1]) / 2.0


class CMAESEngine:
    """
    CMA-ES with standard hyperparameters per Hansen's recommended defaults.
    """

    def __init__(self, db=None, n_params: int = _N_PARAMS, lam: int = _LAMBDA):
        self._db    = db
        self.n: int = n_params
        self.lam: int = lam
        self.mu:  int = lam // 2

        # Recombination weights
        self._w, self._mu_eff = self._init_weights()

        # Step-size control constants
        c_sigma  = (self.mu + 2) / (n_params + self.mu + 5)
        d_sigma  = 1 + 2 * max(0, math.sqrt((self.mu - 1) / (n_params + 1)) - 1) + c_sigma
        # Covariance control constants
        c_c   = (4 + self._mu_eff / n_params) / (n_params + 4 + 2 * self._mu_eff / n_params)
        c_1   = 2 / ((n_params + 1.3)**2 + self._mu_eff)
        c_mu  = min(
            1 - c_1,
            2 * (self._mu_eff - 2 + 1/self._mu_eff) / ((n_params + 2)**2 + self._mu_eff)
        )
        c_m   = 1.0   # learning rate for mean (standard = 1)
        self._c_sigma = c_sigma;  self._d_sigma = d_sigma
        self._c_c = c_c;          self._c_1  = c_1
        self._c_mu = c_mu;        self._c_m  = c_m

        # State
        self.m:     np.ndarray = _M_INIT.copy()   # mean
        self.sigma: float      = 0.3               # step size
        self.C:     np.ndarray = np.eye(n_params)  # covariance matrix
        self.p_sigma: np.ndarray = np.zeros(n_params)
        self.p_c:     np.ndarray = np.zeros(n_params)
        self.generation: int   = 0

        # Expected length of N(0,I) — used in step-size control
        # E‖N(0,I)‖ ≈ √n(1 − 1/(4n) + 1/(21n²))
        self._chi_n = math.sqrt(n_params) * (
            1 - 1/(4*n_params) + 1/(21*n_params**2)
        )

    # ── Weight Initialisation ─────────────────────────────────────────────────
    def _init_weights(self) -> tuple[np.ndarray, float]:
        """Compute log-based recombination weights and μ_eff."""
        w_raw = np.array([math.log(self.mu + 0.5) - math.log(i+1) for i in range(self.mu)])
        w     = w_raw / w_raw.sum()
        mu_eff = 1.0 / np.sum(w**2)
        return w, mu_eff

    # ── Ask ───────────────────────────────────────────────────────────────────
    def ask(self) -> np.ndarray:
        """
        Sample λ candidate parameter vectors from N(m, σ²C).
        Uses Cholesky decomposition for efficient covariance sampling.

        Returns array of shape (λ, n) after clipping to parameter bounds.
        """
        try:
            A = np.linalg.cholesky(self.C + 1e-10 * np.eye(self.n))
        except np.linalg.LinAlgError:
            self.C = (self.C + self.C.T) / 2 + 1e-8 * np.eye(self.n)
            A = np.linalg.cholesky(self.C)

        z = np.random.randn(self.lam, self.n)      # (λ, n) standard normals
        candidates = self.m + self.sigma * (z @ A.T)

        # Clip to parameter bounds
        candidates = np.clip(candidates, _BOUNDS[:, 0], _BOUNDS[:, 1])
        return candidates

    # ── Tell ──────────────────────────────────────────────────────────────────
    def tell(self, candidates: np.ndarray, fitness: np.ndarray):
        """
        Update CMA-ES distribution given evaluated candidates and their fitness.

        fitness[i] should be the Sharpe ratio for candidates[i].
        Higher fitness = better. Internally sorts descending.
        """
        # Sort by fitness descending
        idx = np.argsort(fitness)[::-1][:self.mu]
        x_sorted = candidates[idx]   # top μ candidates

        # Compute steps y_i = (x_i - m) / σ
        y = (x_sorted - self.m) / self.sigma   # (μ, n)

        # Weighted mean step
        y_w = np.dot(self._w, y)               # (n,)

        # Mean update
        self.m = self.m + self._c_m * self.sigma * y_w

        # Step-size control path p_σ
        # C^{-½} y_w via eigendecomposition
        eigvals, eigvecs = np.linalg.eigh(self.C)
        eigvals = np.maximum(eigvals, 1e-14)
        C_invsqrt = eigvecs @ np.diag(1.0 / np.sqrt(eigvals)) @ eigvecs.T
        C_invsqrt_yw = C_invsqrt @ y_w

        sqrt_term = math.sqrt(self._c_sigma * (2 - self._c_sigma) * self._mu_eff)
        self.p_sigma = (1 - self._c_sigma) * self.p_sigma + sqrt_term * C_invsqrt_yw

        # h_σ indicator (avoid negative definite C)
        p_sigma_norm = np.linalg.norm(self.p_sigma)
        h_sigma = 1.0 if p_sigma_norm / math.sqrt(
            1 - (1 - self._c_sigma)**(2*(self.generation+1))
        ) < (1.4 + 2/(self.n+1)) * self._chi_n else 0.0

        # Covariance evolution path p_c
        sqrt_c = math.sqrt(self._c_c * (2 - self._c_c) * self._mu_eff)
        self.p_c = (1 - self._c_c) * self.p_c + h_sigma * sqrt_c * y_w

        # Covariance update
        delta_h = (1 - h_sigma) * self._c_c * (2 - self._c_c)
        self.C  = (
            (1 - self._c_1 - self._c_mu + delta_h) * self.C
            + self._c_1 * np.outer(self.p_c, self.p_c)
            + self._c_mu * sum(
                self._w[i] * np.outer(y[i], y[i]) for i in range(self.mu)
            )
        )
        # Enforce symmetry and positive definiteness
        self.C = (self.C + self.C.T) / 2

        # Step-size update (cumulative step-size adaptation)
        self.sigma *= math.exp(
            (self._c_sigma / self._d_sigma)
            * (np.linalg.norm(self.p_sigma) / self._chi_n - 1)
        )
        self.sigma = float(np.clip(self.sigma, 1e-6, 10.0))

        self.generation += 1
        logger.debug(
            f"CMA-ES gen={self.generation} σ={self.sigma:.4f} "
            f"best_fitness={fitness[idx[0]]:.4f}"
        )

    # ── Fitness Function ──────────────────────────────────────────────────────
    def evaluate_fitness(
        self, params: np.ndarray, trade_history: list[dict]
    ) -> float:
        """
        Sharpe ratio of simulated PnL using these parameters on trade history.

        Applies a penalty for parameter vectors outside bounds (barrier method):
          penalty = 100 * Σ max(0, lo - pᵢ)² + max(0, pᵢ - hi)²
        """
        penalty = 0.0
        for i, (lo, hi) in enumerate(_BOUNDS):
            v = params[i]
            if v < lo:
                penalty += 100 * (lo - v)**2
            elif v > hi:
                penalty += 100 * (v - hi)**2

        if penalty > 0:
            return -penalty

        if len(trade_history) < 10:
            return 0.0

        loan_frac    = float(params[0])
        min_profit   = float(params[2])
        slippage     = float(params[1])

        profits = []
        for t in trade_history[-200:]:
            gross = t.get("net_profit_usd") or 0.0
            # Simulate: accept trades above min_profit threshold
            if gross > min_profit:
                # Adjust for slippage change vs original trade's slippage
                slippage_adj = gross * (1 - slippage / 10000)
                profits.append(slippage_adj * loan_frac)

        if len(profits) < 5:
            return -1.0

        mu  = statistics.mean(profits)
        std = statistics.stdev(profits) if len(profits) > 1 else 1.0
        # Annualised Sharpe (assuming ~1440 scan cycles/day)
        trades_per_day = max(len(profits) / max(len(trade_history)/1440, 0.001), 1)
        sharpe = (mu / max(std, 1e-9)) * math.sqrt(trades_per_day)
        return float(sharpe)

    # ── Evolve ────────────────────────────────────────────────────────────────
    def evolve(self, trade_history: list[dict]):
        """One full CMA-ES generation: ask → evaluate → tell."""
        candidates = self.ask()
        fitness    = np.array([
            self.evaluate_fitness(c, trade_history) for c in candidates
        ])
        self.tell(candidates, fitness)

    # ── Best Params ───────────────────────────────────────────────────────────
    def get_best_params(self) -> dict:
        """Return current mean m as a named parameter dict."""
        m_clipped = np.clip(self.m, _BOUNDS[:, 0], _BOUNDS[:, 1])
        return {name: float(m_clipped[i]) for i, name in enumerate(_PARAM_NAMES)}

    def get_confidence(self) -> float:
        """
        Convergence confidence: σ small → well-converged → high confidence.
        confidence = 1 / (1 + σ)
        """
        return float(1.0 / (1.0 + self.sigma))
