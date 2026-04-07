"""
ai/thompson_engine.py
=====================
Thompson Sampling with Gaussian-Gaussian conjugate model for contextual bandit.

Reference: Agrawal & Goyal "Analysis of Thompson Sampling for the Multi-Armed Bandit
           Problem" (2012). Achieves O(log T) regret — optimal for non-stationary envs.
           Chapelle & Li (2011): outperforms UCB/ε-greedy in production systems.

Model:
  Each context bucket (hour, gas_tier, protocol) maintains a Gaussian posterior
  over expected reward μ (profit in USD):

  Prior:         μ ~ N(μ₀, σ₀²)  with μ₀=0, σ₀²=100 (uninformative)
  Likelihood:    reward ~ N(μ, σ_noise²)  with σ_noise=10 USD

  Conjugate posterior update (known observation variance):
    σ_n²  = 1 / (1/σ₀² + n/σ_noise²)
    μ_n   = σ_n² · (μ₀/σ₀² + Σrᵢ/σ_noise²)

  Sampling:     μ̃ ~ N(μ_n, σ_n²)  → execute if μ̃ > threshold
  Confidence:   P(μ > 0) = 1 − Φ(−μ_n / √σ_n²)

Context: (hour [0-23], gas_tier [0-2], protocol [0-2])
Total contexts: 24 × 3 × 3 = 216 independent arms
"""

from __future__ import annotations

import json
import logging
import math

import numpy as np
from scipy import stats

logger = logging.getLogger(__name__)

_N_HOURS    = 24
_N_GAS_TIERS= 3   # 0=low<20gwei, 1=medium<60gwei, 2=high≥60gwei
_N_PROTOCOLS= 3   # 0=uniswap, 1=curve, 2=balancer
_MU_0       = 0.0
_SIGMA_0_SQ = 100.0   # flat prior — large initial uncertainty
_SIGMA_NOISE_SQ = 100.0  # observation noise variance (USD²)


class ThompsonEngine:
    """
    Gaussian-Gaussian Thompson Sampling.
    Separates expected reward estimation from binary win/lose.
    Naturally handles continuous reward magnitude for position sizing.
    """

    def __init__(self, db=None):
        self._db = db
        shape = (_N_HOURS, _N_GAS_TIERS, _N_PROTOCOLS)
        # Posterior parameters
        self.mu_n:      np.ndarray = np.full(shape, _MU_0,       dtype=np.float64)
        self.sigma_n_sq:np.ndarray = np.full(shape, _SIGMA_0_SQ, dtype=np.float64)
        self.n_obs:     np.ndarray = np.zeros(shape, dtype=np.int64)

    # ── Context Mapping ───────────────────────────────────────────────────────
    def _context(self, hour: int, gas_gwei: float, protocol: str) -> tuple[int,int,int]:
        h = int(hour) % 24
        if gas_gwei < 20:
            g = 0
        elif gas_gwei < 60:
            g = 1
        else:
            g = 2
        proto_map = {"uniswap_v3": 0, "curve": 1, "balancer": 2}
        p = proto_map.get(str(protocol).lower(), 0)
        return h, g, p

    # ── Sampling ──────────────────────────────────────────────────────────────
    def sample_expected_reward(
        self, hour: int, gas_gwei: float, protocol: str
    ) -> float:
        """
        Draw μ̃ ~ N(μ_n[ctx], σ_n²[ctx]).
        A positive draw means the engine is optimistic about this trade.
        """
        ctx = self._context(hour, gas_gwei, protocol)
        mu  = self.mu_n[ctx]
        sig = math.sqrt(max(self.sigma_n_sq[ctx], 1e-12))
        return float(np.random.normal(mu, sig))

    def get_confidence(
        self, hour: int, gas_gwei: float, protocol: str
    ) -> float:
        """
        P(μ > 0) = 1 − Φ(−μ_n / √σ_n²)
        Returns probability that the true mean reward is positive.
        """
        ctx = self._context(hour, gas_gwei, protocol)
        mu  = self.mu_n[ctx]
        sig = math.sqrt(max(self.sigma_n_sq[ctx], 1e-12))
        # Φ is the standard normal CDF
        confidence = float(1.0 - stats.norm.cdf(-mu / sig))
        return float(np.clip(confidence, 0.0, 1.0))

    # ── Posterior Update ──────────────────────────────────────────────────────
    def update(
        self, hour: int, gas_gwei: float, protocol: str, reward_usd: float
    ):
        """
        Gaussian-Gaussian conjugate posterior update.

        σ_n²  = 1 / (1/σ_{n-1}² + 1/σ_noise²)
        μ_n   = σ_n² · (μ_{n-1}/σ_{n-1}² + r/σ_noise²)
        """
        ctx = self._context(hour, gas_gwei, protocol)
        h, g, p = ctx

        sigma_prev = self.sigma_n_sq[h, g, p]
        mu_prev    = self.mu_n[h, g, p]

        # Precision update (addition of information)
        precision_prev  = 1.0 / max(sigma_prev, 1e-12)
        precision_obs   = 1.0 / _SIGMA_NOISE_SQ
        precision_new   = precision_prev + precision_obs

        self.sigma_n_sq[h, g, p] = 1.0 / precision_new
        self.mu_n[h, g, p] = (
            mu_prev * precision_prev + reward_usd * precision_obs
        ) / precision_new
        self.n_obs[h, g, p] += 1

        logger.debug(
            f"Thompson update h={hour} g={g} p={p}: "
            f"μ={self.mu_n[h,g,p]:.4f} σ²={self.sigma_n_sq[h,g,p]:.4f} n={self.n_obs[h,g,p]}"
        )

    # ── UCB Exploration Bonus ─────────────────────────────────────────────────
    def get_ucb_score(
        self, hour: int, gas_gwei: float, protocol: str, total_plays: int
    ) -> float:
        """
        Upper Confidence Bound (UCB1) as a secondary exploration signal.
        UCB = μ_n + √(2 ln(N) / n_obs)
        Used by CompositeBrain when n_obs is very low (<10).
        """
        ctx = self._context(hour, gas_gwei, protocol)
        n   = self.n_obs[ctx]
        mu  = self.mu_n[ctx]
        if n == 0:
            return float("inf")
        exploration = math.sqrt(2.0 * math.log(max(total_plays, 1)) / n)
        return float(mu + exploration)

    # ── Persistence ───────────────────────────────────────────────────────────
    def to_dict(self) -> dict:
        return {
            "mu_n":       self.mu_n.tolist(),
            "sigma_n_sq": self.sigma_n_sq.tolist(),
            "n_obs":      self.n_obs.tolist(),
        }

    def from_dict(self, d: dict):
        self.mu_n       = np.array(d["mu_n"])
        self.sigma_n_sq = np.array(d["sigma_n_sq"])
        self.n_obs      = np.array(d["n_obs"])
