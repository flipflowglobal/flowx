"""
ai/ppo_engine.py
================
Proximal Policy Optimization (PPO) with linear policy approximation.
Pure NumPy — no PyTorch, TensorFlow, or CUDA required. ARM64-compatible.

Reference: Schulman et al. "Proximal Policy Optimization Algorithms" (2017)
           https://arxiv.org/abs/1707.06347

Architecture:
  State  s ∈ ℝ^7 = [gas_norm, volatility, hour_sin, hour_cos,
                     win_rate_5, win_rate_20, liquidity_score]
  Action a ∈ {0,1,2,3} = skip / small(10%) / medium(30%) / large(70%)
  Policy π_θ(a|s) = softmax(W @ s + b)          W∈ℝ^{4×7}, b∈ℝ^4
  Value  V_φ(s)   = w_v · s + b_v               w_v∈ℝ^7,  b_v∈ℝ

PPO Clipped Objective:
  r_t(θ) = π_θ(a_t|s_t) / π_{θ_old}(a_t|s_t)
  L^{CLIP}(θ) = E[min(r_t A_t, clip(r_t, 1−ε, 1+ε) A_t)]

Advantage via Generalised Advantage Estimation (GAE, λ=0.95):
  δ_t   = r_t + γ V(s_{t+1}) - V(s_t)
  A_t   = Σ_{k=0}^{T-t} (γλ)^k δ_{t+k}

Gradient (analytical, no autograd):
  ∂L/∂W = ratio_clipped · A · ∇_W log π(a|s)
  where ∇_W log π(a|s) = (e_a - π(s)) ⊗ s   (softmax cross-entropy gradient)
"""

from __future__ import annotations

import json
import logging
import math
import time
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Hyperparameters ────────────────────────────────────────────────────────────
_N_FEATURES    = 7
_N_ACTIONS     = 4
_CLIP_EPS      = 0.20
_GAMMA         = 0.99
_LAM           = 0.95    # GAE lambda
_LR_INIT       = 3e-4
_LR_MIN        = 1e-5
_LR_DECAY_STEPS= 10_000
_ROLLOUT_SIZE  = 64
_N_EPOCHS      = 4
_VALUE_COEF    = 0.5
_ENTROPY_COEF  = 0.01    # encourages exploration


class PPOEngine:
    """
    Linear-policy PPO for trading action selection.

    Actions
    -------
    0 : skip  — do not execute
    1 : small — borrow 10% of max_loan
    2 : medium— borrow 30% of max_loan
    3 : large — borrow 70% of max_loan
    """

    def __init__(self, db=None):
        self._db = db

        # Policy parameters (Xavier initialisation)
        scale = math.sqrt(2.0 / (_N_FEATURES + _N_ACTIONS))
        self.W:   np.ndarray = np.random.randn(_N_ACTIONS, _N_FEATURES) * scale
        self.b:   np.ndarray = np.zeros(_N_ACTIONS)
        # Value function parameters
        self.W_v: np.ndarray = np.random.randn(_N_FEATURES) * scale
        self.b_v: float      = 0.0

        self._step: int            = 0
        self._rollout: list[dict]  = []

        self._load()

    # ── Feature Engineering ───────────────────────────────────────────────────
    def get_state(
        self,
        gas_gwei: float,
        volatility: float,
        recent_trades: list[dict],
    ) -> np.ndarray:
        """
        Normalise inputs into a 7-dimensional state vector.

        Feature           Normalisation
        ─────────────────────────────────────────
        gas_norm          log1p(gwei) / log1p(200)
        volatility        clip(vol, 0, 0.5) / 0.5
        hour_sin          sin(2π·h/24)
        hour_cos          cos(2π·h/24)
        win_rate_5        fraction of last 5 profitable
        win_rate_20       fraction of last 20 profitable
        liquidity_score   0.5 constant (updated externally)
        """
        h = time.gmtime().tm_hour
        def win_rate(n: int) -> float:
            trades = recent_trades[:n]
            if not trades:
                return 0.5
            return sum(1 for t in trades if (t.get("net_profit_usd") or 0) > 0) / len(trades)

        return np.array([
            math.log1p(max(gas_gwei, 0)) / math.log1p(200),
            min(max(volatility, 0), 0.5) / 0.5,
            math.sin(2 * math.pi * h / 24),
            math.cos(2 * math.pi * h / 24),
            win_rate(5),
            win_rate(20),
            0.5,
        ], dtype=np.float64)

    # ── Policy & Value ────────────────────────────────────────────────────────
    def _logits(self, s: np.ndarray) -> np.ndarray:
        return self.W @ s + self.b

    def _softmax(self, logits: np.ndarray) -> np.ndarray:
        # Numerically stable softmax
        e = np.exp(logits - logits.max())
        return e / e.sum()

    def _value(self, s: np.ndarray) -> float:
        return float(self.W_v @ s + self.b_v)

    def select_action(self, state: np.ndarray) -> tuple[int, float]:
        """
        Sample action from policy distribution.
        Returns (action_index, log_probability).
        """
        probs  = self._softmax(self._logits(state))
        action = int(np.random.choice(_N_ACTIONS, p=probs))
        log_p  = math.log(probs[action] + 1e-10)
        return action, log_p

    def get_confidence(self, state: np.ndarray, action: int) -> float:
        """Return π_θ(action|state) — probability mass on this action."""
        probs = self._softmax(self._logits(state))
        return float(probs[action])

    # ── GAE Computation ───────────────────────────────────────────────────────
    def _compute_gae(
        self,
        rewards: list[float],
        values:  list[float],
        dones:   list[bool],
    ) -> np.ndarray:
        """
        Generalised Advantage Estimation.
        A_t = Σ_{k=0}^{T-t-1} (γλ)^k δ_{t+k}
        δ_t = r_t + γ V(s_{t+1})(1-d_t) - V(s_t)
        """
        T   = len(rewards)
        adv = np.zeros(T, dtype=np.float64)
        gae = 0.0
        for t in reversed(range(T)):
            next_val = values[t + 1] if t + 1 < T else 0.0
            done_mask = 0.0 if dones[t] else 1.0
            delta = rewards[t] + _GAMMA * next_val * done_mask - values[t]
            gae   = delta + _GAMMA * _LAM * done_mask * gae
            adv[t] = gae
        return adv

    # ── PPO Update ────────────────────────────────────────────────────────────
    def add_transition(
        self,
        state:      np.ndarray,
        action:     int,
        reward:     float,
        next_state: np.ndarray,
        done:       bool,
        log_prob:   float,
    ):
        """Buffer a transition. Triggers update when rollout is full."""
        self._rollout.append({
            "s": state, "a": action, "r": reward,
            "s_next": next_state, "done": done, "log_p": log_prob,
        })
        if len(self._rollout) >= _ROLLOUT_SIZE:
            self._update()

    def _update(self):
        """Run N_EPOCHS of mini-batch PPO update on the current rollout buffer."""
        if not self._rollout:
            return

        states   = np.array([t["s"]     for t in self._rollout])   # (T,7)
        actions  = np.array([t["a"]     for t in self._rollout])   # (T,)
        rewards  = [t["r"]  for t in self._rollout]
        dones    = [t["done"] for t in self._rollout]
        old_lps  = np.array([t["log_p"] for t in self._rollout])  # (T,)

        values = [self._value(s) for s in states]
        adv    = self._compute_gae(rewards, values, dones)
        adv    = (adv - adv.mean()) / (adv.std() + 1e-8)   # normalise
        rets   = adv + np.array(values)                     # TD(λ) returns

        lr = max(_LR_MIN, _LR_INIT * (1 - self._step / _LR_DECAY_STEPS))
        T  = len(self._rollout)

        for _ in range(_N_EPOCHS):
            idx = np.random.permutation(T)
            for i in idx:
                s   = states[i]
                a   = actions[i]
                A   = adv[i]
                ret = rets[i]

                probs    = self._softmax(self._logits(s))
                new_lp   = math.log(probs[a] + 1e-10)
                ratio    = math.exp(new_lp - old_lps[i])

                # Clipped surrogate
                clip_ratio = min(max(ratio, 1 - _CLIP_EPS), 1 + _CLIP_EPS)
                pg_loss    = -min(ratio * A, clip_ratio * A)

                # Policy gradient: ∂L/∂W = -ratio_eff * A * (e_a - π) ⊗ s
                ratio_eff  = ratio if abs(ratio) <= (1 + _CLIP_EPS) else 0.0
                one_hot    = np.zeros(_N_ACTIONS)
                one_hot[a] = 1.0
                d_logits   = -(ratio_eff * A) * (one_hot - probs)    # (4,)
                # Entropy bonus gradient
                d_logits  -= _ENTROPY_COEF * (-probs * (np.log(probs + 1e-10) + 1))

                self.W   -= lr * np.outer(d_logits, s)
                self.b   -= lr * d_logits

                # Value function update: MSE loss gradient
                v_pred    = self._value(s)
                v_err     = v_pred - ret
                self.W_v -= lr * _VALUE_COEF * v_err * s
                self.b_v -= lr * _VALUE_COEF * v_err

        self._step    += T
        self._rollout  = []
        self.save()
        logger.debug(f"PPO updated: step={self._step} lr={lr:.2e} adv_mean={adv.mean():.4f}")

    # ── Persistence ───────────────────────────────────────────────────────────
    def save(self):
        if self._db is None:
            return
        import asyncio, concurrent.futures
        data = {
            "W":   self.W.tolist(),  "b":   self.b.tolist(),
            "W_v": self.W_v.tolist(),"b_v": float(self.b_v),
            "step": self._step,
        }
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(self._db.set_system_stat("ppo_weights", json.dumps(data)))
        except Exception:
            pass

    def _load(self):
        # Synchronous load not possible without running event loop; weights persist via DB
        # On first run, Xavier-initialised weights are used (already done in __init__)
        pass
