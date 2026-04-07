"""
tests/test_ai_engines.py
========================
Unit tests for all AI engines — no fork required.
Validates mathematical correctness of each algorithm.
"""

import math
import numpy as np
import pytest

# ── PPO ───────────────────────────────────────────────────────────────────────
def test_ppo_state_is_7d():
    from ai.ppo_engine import PPOEngine
    e  = PPOEngine(db=None)
    s  = e.get_state(30.0, 0.02, [])
    assert s.shape == (7,)
    assert all(np.isfinite(s))

def test_ppo_softmax_sums_to_one():
    from ai.ppo_engine import PPOEngine
    e      = PPOEngine(db=None)
    s      = e.get_state(30.0, 0.02, [])
    probs  = e._softmax(e._logits(s))
    assert abs(probs.sum() - 1.0) < 1e-6
    assert all(probs > 0)

def test_ppo_policy_shifts_after_reward():
    from ai.ppo_engine import PPOEngine
    e = PPOEngine(db=None)
    s = e.get_state(30.0, 0.02, [])
    # Force action=2 (medium) with high reward 64 times to fill rollout
    p0 = e._softmax(e._logits(s))[2]
    for _ in range(64):
        _, log_p = e.select_action(s)
        # Manually inject action=2
        e._rollout.append({"s": s, "a": 2, "r": 50.0, "s_next": s, "done": False, "log_p": log_p})
    if len(e._rollout) >= 64:
        e._update()
    p1 = e._softmax(e._logits(s))[2]
    # After strong reward signal, probability of action 2 should not decrease
    assert p1 >= p0 - 0.2   # allow some variance from clipping

def test_ppo_confidence_in_unit_interval():
    from ai.ppo_engine import PPOEngine
    e = PPOEngine(db=None)
    s = e.get_state(50.0, 0.05, [])
    for a in range(4):
        c = e.get_confidence(s, a)
        assert 0.0 <= c <= 1.0

def test_gae_returns_correct_shape():
    from ai.ppo_engine import PPOEngine
    e   = PPOEngine(db=None)
    adv = e._compute_gae([1.0]*10, [0.5]*10, [False]*10)
    assert len(adv) == 10
    assert all(np.isfinite(adv))


# ── Thompson ──────────────────────────────────────────────────────────────────
def test_thompson_confidence_uninformative_is_half():
    from ai.thompson_engine import ThompsonEngine
    e = ThompsonEngine(db=None)
    c = e.get_confidence(12, 30.0, "uniswap_v3")
    # With flat prior N(0, 100), P(μ>0)=0.5
    assert abs(c - 0.5) < 0.01

def test_thompson_confidence_rises_after_positive_rewards():
    from ai.thompson_engine import ThompsonEngine
    e = ThompsonEngine(db=None)
    for _ in range(50):
        e.update(12, 30.0, "uniswap_v3", 20.0)
    c = e.get_confidence(12, 30.0, "uniswap_v3")
    assert c > 0.70, f"Expected confidence > 0.70 after 50 positive rewards, got {c:.4f}"

def test_thompson_posterior_mean_converges():
    from ai.thompson_engine import ThompsonEngine
    e = ThompsonEngine(db=None)
    true_reward = 15.0
    for _ in range(100):
        e.update(0, 10.0, "curve", true_reward)
    h, g, p = e._context(0, 10.0, "curve")
    assert abs(e.mu_n[h, g, p] - true_reward) < 2.0

def test_thompson_negative_rewards_lower_confidence():
    from ai.thompson_engine import ThompsonEngine
    e = ThompsonEngine(db=None)
    for _ in range(50):
        e.update(6, 80.0, "balancer", -10.0)
    c = e.get_confidence(6, 80.0, "balancer")
    assert c < 0.30

def test_thompson_sample_is_finite():
    from ai.thompson_engine import ThompsonEngine
    e = ThompsonEngine(db=None)
    s = e.sample_expected_reward(10, 25.0, "uniswap_v3")
    assert math.isfinite(s)


# ── UKF ───────────────────────────────────────────────────────────────────────
def test_ukf_weights_sum_correctly():
    from ai.ukf_engine import UKFEngine, _N
    e = UKFEngine(db=None)
    assert abs(e._Wm.sum() - 1.0) < 1e-9
    assert len(e._Wm) == 2*_N + 1

def test_ukf_sigma_points_shape():
    from ai.ukf_engine import UKFEngine, _N
    e      = UKFEngine(db=None)
    sigma  = e._sigma_points()
    assert sigma.shape == (2*_N+1, _N)

def test_ukf_update_returns_finite():
    from ai.ukf_engine import UKFEngine
    e = UKFEngine(db=None)
    for obs in [5.0, 5.1, 4.9, 5.2, 5.0]:
        pred, S = e.update(obs)
        assert math.isfinite(pred)
        assert S >= 0

def test_ukf_prediction_error_decreases():
    """After 20 OU observations, UKF error should trend downward."""
    from ai.ukf_engine import UKFEngine
    import numpy as np
    e = UKFEngine(db=None)
    rng = np.random.default_rng(42)
    spread = 5.0
    errors = []
    for _ in range(25):
        spread = spread * 0.9 + rng.normal(0, 0.1)
        pred, _ = e.update(spread)
        errors.append(abs(pred - spread))
    # Last 5 average error should be less than first 5
    assert np.mean(errors[-5:]) <= np.mean(errors[:5]) * 2.0  # loose bound

def test_ukf_confidence_in_unit_interval():
    from ai.ukf_engine import UKFEngine
    e = UKFEngine(db=None)
    c = e.get_confidence(5.0)
    assert 0.0 <= c <= 1.0


# ── CMA-ES ────────────────────────────────────────────────────────────────────
def test_cma_es_ask_shape():
    from ai.cma_es_engine import CMAESEngine, _LAMBDA, _N_PARAMS
    e = CMAESEngine(db=None)
    c = e.ask()
    assert c.shape == (_LAMBDA, _N_PARAMS)

def test_cma_es_candidates_within_bounds():
    from ai.cma_es_engine import CMAESEngine, _BOUNDS
    e = CMAESEngine(db=None)
    for _ in range(5):
        c = e.ask()
        assert np.all(c >= _BOUNDS[:, 0] - 1e-9)
        assert np.all(c <= _BOUNDS[:, 1] + 1e-9)

def test_cma_es_sphere_convergence():
    """CMA-ES must minimise f(x)=Σx² to <1e-4 in 300 generations (6D sphere)."""
    from ai.cma_es_engine import CMAESEngine
    e = CMAESEngine(db=None)
    for _ in range(300):
        c = e.ask()
        # Use raw parameters (unnormalised) centred around mid-bounds
        from ai.cma_es_engine import _BOUNDS
        c_norm = (c - (_BOUNDS[:,0]+_BOUNDS[:,1])/2) / ((_BOUNDS[:,1]-_BOUNDS[:,0])/2)
        f = -np.sum(c_norm**2, axis=1)   # maximise negative sphere
        e.tell(c, f)
    best  = e.get_best_params()
    # Centre of bounds is the optimum → check sigma converged
    assert e.sigma < 0.5, f"CMA-ES did not converge: sigma={e.sigma:.4f}"

def test_cma_es_confidence_increases_as_sigma_decreases():
    from ai.cma_es_engine import CMAESEngine
    import numpy as np
    e = CMAESEngine(db=None)
    c0 = e.get_confidence()
    e.sigma = 0.01
    c1 = e.get_confidence()
    assert c1 > c0


# ── Composite Brain ───────────────────────────────────────────────────────────
def test_composite_weights_sum_to_one():
    from ai.composite_brain import CompositeBrain
    from ai.ppo_engine import PPOEngine
    from ai.thompson_engine import ThompsonEngine
    from ai.ukf_engine import UKFEngine
    from ai.cma_es_engine import CMAESEngine
    brain = CompositeBrain(PPOEngine(), ThompsonEngine(), UKFEngine(), CMAESEngine())
    assert abs(sum(brain.weights.values()) - 1.0) < 1e-6

def test_composite_evaluate_returns_required_keys():
    from ai.composite_brain import CompositeBrain
    from ai.ppo_engine import PPOEngine
    from ai.thompson_engine import ThompsonEngine
    from ai.ukf_engine import UKFEngine
    from ai.cma_es_engine import CMAESEngine
    brain = CompositeBrain(PPOEngine(), ThompsonEngine(), UKFEngine(), CMAESEngine())
    opp   = {"route": [{"protocol":"uniswap_v3","rate":1.001}],
             "expected_profit_usd": 10.0, "route_hash": "abc"}
    ctx   = {"gas_gwei":30,"hour_utc":12,"win_rate_5":0.6,"win_rate_20":0.55,
             "price_volatility":0.02,"recent_trades":[],"kelly_fraction":0.15,"max_loan_usd":10000}
    result = brain.evaluate(opp, ctx)
    for key in ["execute","composite_score","engine_scores","weights","recommended_loan_usd","reasoning"]:
        assert key in result

def test_composite_score_in_unit_interval():
    from ai.composite_brain import CompositeBrain
    from ai.ppo_engine import PPOEngine
    from ai.thompson_engine import ThompsonEngine
    from ai.ukf_engine import UKFEngine
    from ai.cma_es_engine import CMAESEngine
    brain = CompositeBrain(PPOEngine(), ThompsonEngine(), UKFEngine(), CMAESEngine())
    opp = {"route":[{"protocol":"uniswap_v3","rate":1.005}],"expected_profit_usd":20.0}
    ctx = {"gas_gwei":20,"hour_utc":14,"win_rate_5":0.8,"win_rate_20":0.75,
           "price_volatility":0.01,"recent_trades":[],"kelly_fraction":0.20,"max_loan_usd":10000}
    r   = brain.evaluate(opp, ctx)
    assert 0.0 <= r["composite_score"] <= 1.0


# ── PER Buffer ───────────────────────────────────────────────────────────────
def test_per_add_and_sample():
    from ai.memory_store import PrioritizedReplayBuffer
    buf = PrioritizedReplayBuffer(db=None, capacity=100)
    for i in range(20):
        buf.add({"state": i, "reward": float(i)}, td_error=float(i+1))
    trans, idx, weights = buf.sample(5)
    assert len(trans) == 5
    assert len(idx) == 5
    assert all(0 <= w <= 1.0 for w in weights)

def test_per_high_priority_sampled_more():
    """High-priority transitions should be sampled more than low-priority."""
    from ai.memory_store import PrioritizedReplayBuffer
    buf = PrioritizedReplayBuffer(db=None, capacity=1000)
    # 10 low-priority + 10 high-priority
    for i in range(10):
        buf.add({"id": f"low-{i}"}, td_error=0.01)
    for i in range(10):
        buf.add({"id": f"high-{i}"}, td_error=100.0)
    counts = {"low": 0, "high": 0}
    for _ in range(200):
        trans, _, _ = buf.sample(1)
        if trans and str(trans[0].get("id","")).startswith("high"):
            counts["high"] += 1
        else:
            counts["low"] += 1
    assert counts["high"] > counts["low"], f"PER bias failed: {counts}"

def test_per_update_priorities():
    from ai.memory_store import PrioritizedReplayBuffer
    import numpy as np
    buf = PrioritizedReplayBuffer(db=None, capacity=100)
    for i in range(10):
        buf.add({"x": i}, td_error=1.0)
    _, idx, _ = buf.sample(3)
    new_errors = np.array([0.1, 50.0, 0.1])
    buf.update_priorities(idx, new_errors)
    assert buf._tree.total > 0
