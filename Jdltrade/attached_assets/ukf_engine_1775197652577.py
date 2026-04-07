"""
ai/ukf_engine.py
================
Unscented Kalman Filter (UKF) for arbitrage spread prediction.

Reference: Julier & Uhlmann "A New Extension of the Kalman Filter to
           Nonlinear Systems" (1997). Achieves 3rd-order Taylor accuracy
           vs linear KF's 1st-order. No Jacobian required.

Why UKF over linear KF:
  Arbitrage spreads follow a mean-reverting Ornstein-Uhlenbeck (OU) process:
    dX_t = κ(θ − X_t)dt + σ dW_t
  The discrete transition is nonlinear in κ — the linear KF misses this
  curvature entirely. UKF propagates 2n+1 = 7 deterministic sigma points
  through the OU dynamics, capturing the full nonlinear distribution.

State vector x = [spread, velocity, mean_reversion_rate]  (n=3)
  spread:              current observed arb spread (USD)
  velocity:            dspread/dt — rate of change
  mean_reversion_rate: κ in the OU process (learned online)

UKF Parameters (standard values):
  α = 1e-3   (sigma-point spread — small for near-Gaussian)
  β = 2      (optimal for Gaussian distributions)
  κ = 0      (secondary scaling, 0 is standard)
  λ = α²(n+κ) − n

Sigma points Xᵢ (2n+1 = 7 total):
  X₀ = x̂
  Xᵢ = x̂ + √((n+λ)P) column i     for i=1..n
  Xᵢ = x̂ − √((n+λ)P) column (i-n) for i=n+1..2n

Mean weights:   Wᵢᵐ = λ/(n+λ) for i=0; 1/(2(n+λ)) otherwise
Cov  weights:   W₀ᶜ = λ/(n+λ) + (1−α²+β); others = 1/(2(n+λ))
"""

from __future__ import annotations

import logging
import math
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_N   = 3       # state dimension
_ALPHA = 1e-3
_BETA  = 2.0
_KAPPA = 0.0
_LAMBDA = _ALPHA**2 * (_N + _KAPPA) - _N

# Default OU process parameters
_DT         = 1.0    # time step (1 scan cycle)
_SIGMA_PROC = 0.50   # process noise std (USD spread change per step)
_SIGMA_OBS  = 0.10   # observation noise std


class UKFEngine:
    """
    Unscented Kalman Filter tracking arbitrage spread dynamics.
    Predicts spread evolution via the Ornstein-Uhlenbeck nonlinear model.
    """

    def __init__(self, db=None):
        self._db = db

        # State estimate: [spread=0, velocity=0, kappa=0.1]
        self.x: np.ndarray = np.array([0.0, 0.0, 0.1], dtype=np.float64)
        # State covariance
        self.P: np.ndarray = np.diag([1.0, 0.1, 0.01])

        # Process noise covariance Q (diagonal)
        self.Q: np.ndarray = np.diag([_SIGMA_PROC**2, (_SIGMA_PROC*0.1)**2, 1e-6])
        # Observation noise variance
        self.R: float = _SIGMA_OBS**2

        # Precompute weights
        self._Wm: np.ndarray = np.zeros(2*_N+1)
        self._Wc: np.ndarray = np.zeros(2*_N+1)
        self._compute_weights()

        self._history: list[float] = []   # last 100 observed spreads

    # ── Weight Computation ────────────────────────────────────────────────────
    def _compute_weights(self):
        """Compute mean and covariance weights for 2n+1 sigma points."""
        n_lam = _N + _LAMBDA
        self._Wm[0] = _LAMBDA / n_lam
        self._Wc[0] = _LAMBDA / n_lam + (1 - _ALPHA**2 + _BETA)
        for i in range(1, 2*_N+1):
            self._Wm[i] = 1.0 / (2 * n_lam)
            self._Wc[i] = 1.0 / (2 * n_lam)

    # ── Sigma Points ──────────────────────────────────────────────────────────
    def _sigma_points(self) -> np.ndarray:
        """
        Generate 2n+1 sigma points using Cholesky decomposition.
        Returns array of shape (2n+1, n).
        """
        n_lam = _N + _LAMBDA
        try:
            L = np.linalg.cholesky(n_lam * self.P + 1e-10 * np.eye(_N))
        except np.linalg.LinAlgError:
            # P is not positive definite — regularise
            self.P = (self.P + self.P.T) / 2 + 1e-8 * np.eye(_N)
            L = np.linalg.cholesky(n_lam * self.P)

        sigma = np.zeros((2*_N+1, _N))
        sigma[0] = self.x
        for i in range(_N):
            sigma[i+1]   = self.x + L[:, i]
            sigma[_N+1+i] = self.x - L[:, i]
        return sigma

    # ── Nonlinear State Transition (OU process) ───────────────────────────────
    def _transition(self, xi: np.ndarray, dt: float = _DT) -> np.ndarray:
        """
        Discretised Ornstein-Uhlenbeck transition (Euler-Maruyama):
          spread_{t+1}   = spread_t + velocity_t * dt
          velocity_{t+1} = κ_t * (0 − spread_t) * dt + velocity_t * (1 − 0.05*dt)
          κ_{t+1}        = κ_t  (slow-changing)

        The mean-reversion target θ is learned from the spread history mean.
        """
        spread, vel, kappa = xi
        theta = np.mean(self._history[-20:]) if len(self._history) >= 5 else 0.0

        spread_new = spread + vel * dt
        vel_new    = kappa * (theta - spread) * dt + vel * (1 - 0.05 * dt)
        kappa_new  = kappa   # identity — slowly adapted by filter
        return np.array([spread_new, vel_new, kappa_new])

    # ── UKF Predict ───────────────────────────────────────────────────────────
    def _predict(self, dt: float = _DT):
        """UKF predict step: propagate sigma points through nonlinear transition."""
        sigma = self._sigma_points()
        # Propagate each sigma point
        sigma_pred = np.array([self._transition(xi, dt) for xi in sigma])

        # Predicted mean
        x_pred = np.dot(self._Wm, sigma_pred)

        # Predicted covariance
        P_pred = self.Q.copy()
        for i in range(2*_N+1):
            diff = sigma_pred[i] - x_pred
            P_pred += self._Wc[i] * np.outer(diff, diff)

        self._sigma_pred = sigma_pred
        self._x_pred     = x_pred
        self._P_pred     = P_pred

    # ── UKF Update ────────────────────────────────────────────────────────────
    def update(self, observed_spread: float) -> tuple[float, float]:
        """
        Full UKF predict + update cycle.

        H(x) = x[0]  (observe spread component only)

        Returns (predicted_spread, innovation_variance).
        """
        self._history.append(observed_spread)
        if len(self._history) > 200:
            self._history = self._history[-200:]

        self._predict()

        # Predicted observation mean: z_pred = Σ Wᵢᵐ H(σᵢ)
        z_pred = np.dot(self._Wm, self._sigma_pred[:, 0])

        # Innovation covariance S and cross-covariance P_xz
        S   = self.R
        P_xz = np.zeros(_N)
        for i in range(2*_N+1):
            z_i  = self._sigma_pred[i, 0]
            diff = self._sigma_pred[i] - self._x_pred
            S   += self._Wc[i] * (z_i - z_pred)**2
            P_xz += self._Wc[i] * diff * (z_i - z_pred)

        # Kalman gain: K = P_xz / S
        K = P_xz / max(S, 1e-12)

        # State and covariance update
        innovation = observed_spread - z_pred
        self.x = self._x_pred + K * innovation
        self.P = self._P_pred - np.outer(K, K) * S
        # Ensure P stays symmetric positive definite
        self.P = (self.P + self.P.T) / 2

        return float(self.x[0]), float(S)

    # ── Confidence ────────────────────────────────────────────────────────────
    def get_confidence(self, observed_spread: float) -> float:
        """
        Likelihood-based confidence:
          confidence = exp(−0.5 · innovation² / S)

        High when the observed spread matches the prediction well.
        """
        predicted, S = self.update(observed_spread)
        innovation   = observed_spread - predicted
        conf = math.exp(-0.5 * (innovation**2) / max(S, 1e-12))
        return float(np.clip(conf, 0.0, 1.0))

    def predict_next(self) -> tuple[float, float]:
        """
        Predict next spread without incorporating an observation.
        Returns (predicted_spread, uncertainty_std).
        """
        sigma = self._sigma_points()
        sigma_pred = np.array([self._transition(xi) for xi in sigma])
        x_pred = np.dot(self._Wm, sigma_pred)
        P_pred = self.Q.copy()
        for i in range(2*_N+1):
            diff = sigma_pred[i] - x_pred
            P_pred += self._Wc[i] * np.outer(diff, diff)
        return float(x_pred[0]), float(math.sqrt(max(P_pred[0, 0], 0)))
