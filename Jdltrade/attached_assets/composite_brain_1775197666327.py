"""
ai/composite_brain.py
=====================
Weighted ensemble decision maker with Shapley Value attribution.

Reference: Shapley (1953); Lundberg & Lee "A Unified Approach to
           Interpreting Model Predictions" (NeurIPS 2017).

Why Shapley over fixed weights:
  Fixed weights are arbitrary and degrade when one engine enters a bad regime.
  Shapley Value φᵢ is the unique fair allocation of prediction accuracy to each
  engine, satisfying efficiency, symmetry, dummy, and additivity axioms.
  Exact computation for 4 engines requires 2⁴=16 coalition evaluations.

Shapley formula:
  φᵢ = Σ_{S⊆N\{i}} |S|!(|N|−|S|−1)!/|N|! · (v(S∪{i}) − v(S))

where v(S) = accuracy of ensemble restricted to engines in S
           = fraction of trades where sign(Σ_{j∈S} w̄_j score_j) == sign(profit)
           (using uniform weights within S)

Ensemble score:
  composite = Σᵢ φᵢ_norm · scoreᵢ   (φ normalised to sum to 1)

Execution thresholds:
  composite ≥ 0.60 → execute
  composite ≥ 0.80 → execute at 2× loan size

Kelly sizing integration:
  recommended_loan = kelly_fraction × max_loan × confidence_multiplier
"""

from __future__ import annotations

import itertools
import logging
import math
import time
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_ENGINES            = ["ppo", "thompson", "ukf", "cma_es"]
_EXECUTE_THRESHOLD  = 0.60
_HIGH_CONF_THRESH   = 0.80
_WEIGHT_UPDATE_INTERVAL = 100   # trades between Shapley recomputations
_MIN_HISTORY        = 20        # minimum trades before adapting weights


class CompositeBrain:
    """
    Weighted ensemble with online Shapley weight adaptation.
    """

    def __init__(self, ppo, thompson, ukf, cma_es, replay_buffer=None, db=None):
        self._engines = {
            "ppo":      ppo,
            "thompson": thompson,
            "ukf":      ukf,
            "cma_es":   cma_es,
        }
        self._replay  = replay_buffer
        self._db      = db

        # Equal weights until enough data to compute Shapley
        self.weights: dict[str, float] = {k: 0.25 for k in _ENGINES}
        self._pred_history: list[dict] = []   # {scores, composite, outcome_usd}
        self._trades_since_shapley: int = 0

    # ── Evaluate ──────────────────────────────────────────────────────────────
    def evaluate(self, opportunity: dict, market_context: dict) -> dict:
        """
        Gather confidence from all engines, compute weighted composite,
        return full evaluation dict including per-engine breakdown.
        """
        gas_gwei    = market_context.get("gas_gwei", 30.0)
        hour        = market_context.get("hour_utc", time.gmtime().tm_hour)
        volatility  = market_context.get("price_volatility", 0.02)
        recent      = market_context.get("recent_trades", [])
        protocol    = opportunity.get("route", [{}])[0].get("protocol", "uniswap_v3")
        obs_spread  = opportunity.get("expected_profit_usd", 0.0)

        # PPO score
        ppo_state = self._engines["ppo"].get_state(gas_gwei, volatility, recent)
        ppo_action, _ = self._engines["ppo"].select_action(ppo_state)
        ppo_score = self._engines["ppo"].get_confidence(ppo_state, max(ppo_action, 1))

        # Thompson score
        ts_score = self._engines["thompson"].get_confidence(hour, gas_gwei, protocol)

        # UKF score
        ukf_score = self._engines["ukf"].get_confidence(obs_spread)

        # CMA-ES score
        cma_score = self._engines["cma_es"].get_confidence()

        scores = {
            "ppo":      float(ppo_score),
            "thompson": float(ts_score),
            "ukf":      float(ukf_score),
            "cma_es":   float(cma_score),
        }

        # Weighted composite
        composite = sum(self.weights[k] * scores[k] for k in _ENGINES)
        composite = float(np.clip(composite, 0.0, 1.0))

        execute = composite >= _EXECUTE_THRESHOLD

        # Loan sizing: Kelly × confidence multiplier
        kelly_fraction = market_context.get("kelly_fraction", 0.10)
        max_loan = market_context.get("max_loan_usd", 10_000.0)
        if composite >= _HIGH_CONF_THRESH:
            loan_multiplier = 2.0
        elif composite >= _EXECUTE_THRESHOLD:
            loan_multiplier = 1.0
        else:
            loan_multiplier = 0.0

        recommended_loan = float(np.clip(
            kelly_fraction * max_loan * loan_multiplier,
            0, max_loan
        ))

        # Human-readable reasoning
        dominant = max(scores, key=lambda k: self.weights[k] * scores[k])
        reasoning = (
            f"composite={composite:.3f} "
            f"dominant_engine={dominant}({scores[dominant]:.3f}) "
            f"weights={{{','.join(f'{k}:{v:.2f}' for k,v in self.weights.items())}}} "
            f"kelly={kelly_fraction:.3f}"
        )

        record = {"scores": scores, "composite": composite, "outcome_usd": None}
        self._pred_history.append(record)
        if len(self._pred_history) > 500:
            self._pred_history = self._pred_history[-500:]

        return {
            "execute":               execute,
            "composite_score":       composite,
            "engine_scores":         scores,
            "weights":               dict(self.weights),
            "recommended_loan_usd":  recommended_loan,
            "reasoning":             reasoning,
        }

    # ── Outcome Recording ─────────────────────────────────────────────────────
    def record_outcome(self, opportunity_id: int, actual_profit_usd: float):
        """
        Mark the most recent unresolved prediction with its actual outcome.
        Trigger Shapley recomputation if interval reached.
        """
        # Find most recent prediction without outcome
        for rec in reversed(self._pred_history):
            if rec["outcome_usd"] is None:
                rec["outcome_usd"] = actual_profit_usd
                break

        self._trades_since_shapley += 1

        # Update individual engines
        ctx = self._get_current_context()
        self._engines["thompson"].update(
            ctx["hour"], ctx["gas_gwei"], ctx["protocol"], actual_profit_usd
        )
        if actual_profit_usd > 0:
            self._engines["ppo"].add_transition(
                ctx["ppo_state"], ctx["ppo_action"],
                actual_profit_usd, ctx["ppo_state"], False, ctx["ppo_log_p"]
            )
        if self._trades_since_shapley >= _WEIGHT_UPDATE_INTERVAL:
            self._recompute_shapley_weights()
            self._trades_since_shapley = 0

    def _get_current_context(self) -> dict:
        h = time.gmtime().tm_hour
        return {
            "hour": h, "gas_gwei": 30.0, "protocol": "uniswap_v3",
            "ppo_state": np.zeros(7), "ppo_action": 1, "ppo_log_p": -1.4,
        }

    # ── Shapley Weight Computation ────────────────────────────────────────────
    def _recompute_shapley_weights(self):
        """
        Exact Shapley value computation via full coalition enumeration (2^4=16).

        v(S) = accuracy of ensemble using only engines in S on _pred_history
             = mean(sign(composite_S) == sign(outcome))
        """
        resolved = [r for r in self._pred_history if r["outcome_usd"] is not None]
        if len(resolved) < _MIN_HISTORY:
            logger.debug("Shapley: insufficient history, keeping equal weights")
            return

        def coalition_value(subset: tuple[str, ...]) -> float:
            if not subset:
                return 0.0
            n_correct = 0
            for rec in resolved:
                sub_score = sum(rec["scores"].get(e, 0.5) for e in subset) / len(subset)
                predicted_positive = sub_score >= 0.5
                actual_positive    = (rec["outcome_usd"] or 0) > 0
                if predicted_positive == actual_positive:
                    n_correct += 1
            return n_correct / len(resolved)

        engines = list(_ENGINES)
        n = len(engines)
        shapley = {e: 0.0 for e in engines}
        factorial = math.factorial

        for i, engine in enumerate(engines):
            others = [e for e in engines if e != engine]
            for r in range(len(others) + 1):
                for subset in itertools.combinations(others, r):
                    subset_with    = tuple(sorted(subset + (engine,)))
                    subset_without = tuple(sorted(subset))
                    marginal = coalition_value(subset_with) - coalition_value(subset_without)
                    coef     = (factorial(r) * factorial(n - r - 1)) / factorial(n)
                    shapley[engine] += coef * marginal

        # Normalise Shapley values via softmax to get weights ∈ (0,1) summing to 1
        sv = np.array([shapley[e] for e in engines])
        sv_shifted = sv - sv.min() + 1e-9   # ensure positive
        weights_raw = sv_shifted / sv_shifted.sum()

        old = dict(self.weights)
        for i, e in enumerate(engines):
            self.weights[e] = float(weights_raw[i])

        logger.info(
            f"Shapley weights updated: "
            f"{{{', '.join(f'{k}:{v:.3f}' for k,v in self.weights.items())}}} "
            f"(prev: {{{', '.join(f'{k}:{v:.3f}' for k,v in old.items())}}})"
        )

        if self._db is not None:
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(self._db.save_engine_weights(
                        self.weights, shapley, len(resolved)
                    ))
            except Exception:
                pass
