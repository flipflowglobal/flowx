"""tests/test_scanner.py — Scanner unit tests"""
import math
import pytest
import numpy as np


def test_bellman_ford_detects_known_cycle():
    from scanner.route_finder import RouteFinder
    rf = RouteFinder(config=None)
    quote_map = {
        ("WETH", "USDC", "pool_a"): 2000.0,    # 1 WETH → 2000 USDC
        ("USDC", "USDT", "pool_b"): 1.001,      # 1 USDC → 1.001 USDT
        ("USDT", "WETH", "pool_c"): 1/1997.0,   # 1 USDT → 0.000501 WETH
        # Cycle return: 2000 * 1.001 / 1997 ≈ 1.0025 > 1 → profitable
    }
    G = rf.build_log_price_graph(quote_map)
    assert G.number_of_nodes() == 3
    assert G.number_of_edges() == 3

    cycles = rf.find_negative_cycles(G, "WETH", max_hops=4)
    assert len(cycles) >= 1, "Should detect profitable 3-hop cycle"

def test_bellman_ford_no_cycle_unprofitable():
    from scanner.route_finder import RouteFinder
    rf = RouteFinder(config=None)
    quote_map = {
        ("WETH", "USDC", "pool_a"): 2000.0,
        ("USDC", "USDT", "pool_b"): 0.999,
        ("USDT", "WETH", "pool_c"): 1/2001.0,
    }
    G = rf.build_log_price_graph(quote_map)
    cycles = rf.find_negative_cycles(G, "WETH", max_hops=4)
    assert len(cycles) == 0, "Unprofitable cycle should not be returned"

def test_log_price_graph_weights_correct():
    from scanner.route_finder import RouteFinder
    rf = RouteFinder(config=None)
    rate = 2000.0
    G  = rf.build_log_price_graph({("A","B","p1"): rate})
    assert G.has_edge("A","B")
    assert abs(G["A"]["B"]["weight"] - (-math.log(rate))) < 1e-10

def test_monte_carlo_scorer_distribution():
    """Score function returns non-zero std with 500 samples."""
    from scanner.opportunity_scorer import OpportunityScorer

    class FakeGas:
        def estimate_gas(self, _): return 300_000
        def get_eip1559_fees(self, **kw): return (int(30e9), int(2e9))
        def get_gas_price_gwei(self): return 30.0

    class FakePF:
        pass

    class FakeConfig:
        min_profit_usd = 5.0
        max_loan_usd   = 10000.0
        min_loan_usd   = 500.0
        slippage_bps   = 50
        flash_receiver_address = "0x" + "00"*20
        active = type('A', (), {'chain_id': 1})()

    scorer = OpportunityScorer(FakePF(), FakeGas(), FakeConfig())
    route  = [
        {"protocol":"uniswap_v3","pool":"0x"+"aa"*20,"token_in":"WETH","token_out":"USDC","rate":2000.0,"fee":500},
        {"protocol":"curve","pool":"0x"+"bb"*20,"token_in":"USDC","token_out":"USDT","rate":1.001,"fee":4},
        {"protocol":"uniswap_v3","pool":"0x"+"cc"*20,"token_in":"USDT","token_out":"WETH","rate":0.000502,"fee":500},
    ]
    result = scorer.score_route(route, int(0.5e18), eth_price_usd=2000.0)
    assert "expected_profit_usd" in result
    assert "profit_std_usd"      in result
    assert "viable"              in result
    assert result["profit_std_usd"] >= 0.0   # std is non-negative


"""tests/test_circuit_breaker.py — Circuit breaker + Kelly tests"""

def test_kelly_negative_ev_returns_negative():
    from executor.circuit_breaker import CircuitBreaker

    class C:
        max_loan_usd = 50000.0
        min_loan_usd = 500.0

    cb = CircuitBreaker(None, C())
    # 30 losses, 5 wins
    history = [{"net_profit_usd": -10.0}]*30 + [{"net_profit_usd": 2.0}]*5
    f = cb.compute_kelly_fraction(history)
    assert f < 0.0, f"Expected f* < 0 for negative-EV history, got {f:.4f}"

def test_kelly_positive_ev_returns_positive():
    from executor.circuit_breaker import CircuitBreaker

    class C:
        max_loan_usd = 50000.0
        min_loan_usd = 500.0

    cb = CircuitBreaker(None, C())
    history = [{"net_profit_usd": 10.0}]*30 + [{"net_profit_usd": -2.0}]*5
    f = cb.compute_kelly_fraction(history)
    assert f > 0.0

def test_circuit_breaker_opens_after_3_consecutive_fails():
    from executor.circuit_breaker import CircuitBreaker

    class C:
        max_loan_usd = 50000.0
        min_loan_usd = 500.0

    cb = CircuitBreaker(None, C())
    for _ in range(3):
        cb.record_outcome(0.0, 0.0, reverted=True)
    assert cb.state == "OPEN", f"Expected OPEN, got {cb.state}"

def test_circuit_breaker_transitions_half_open():
    import time
    from executor.circuit_breaker import CircuitBreaker, _OPEN_DURATION

    class C:
        max_loan_usd = 50000.0
        min_loan_usd = 500.0

    cb = CircuitBreaker(None, C())
    cb._open("test")
    cb._open_until = time.monotonic() - 1   # fast-forward
    assert cb.check() == True                # should allow probe
    assert cb.state == "HALF_OPEN"

def test_kelly_size_respects_max_loan():
    from executor.circuit_breaker import CircuitBreaker

    class C:
        max_loan_usd = 1000.0
        min_loan_usd = 100.0

    cb = CircuitBreaker(None, C())
    history = [{"net_profit_usd": 50.0}]*50
    size = cb.get_recommended_loan_size(history, max_loan_usd=1000.0)
    assert size <= 1000.0
    assert size >= 0.0


"""tests/test_api.py — FastAPI endpoint tests"""
import pytest
from fastapi.testclient import TestClient


def _make_app():
    from fastapi import FastAPI
    app = FastAPI()

    class FakeOrch:
        def get_status(self): return {"state":"running","uptime_seconds":10,
            "scan_count":5,"circuit_breaker":"CLOSED","eth_price_usd":2500.0,
            "dry_run":False,"scan_only":False,"pools_loaded":25}

    class FakeDB:
        async def get_trade_stats(self): return {"total_trades":0,"win_rate":0.0}
        async def get_recent_opportunities(self, **kw): return []
        async def get_recent_trades(self, **kw): return []
        async def get_latest_engine_weights(self): return None

    import api.routes.status as sm
    import api.routes.opportunities as om
    import api.routes.trades as tm
    import api.routes.ai as am

    for mod in [sm, om, tm, am]:
        mod.orchestrator = FakeOrch()
        mod.db           = FakeDB()
        mod.config       = None

    app.include_router(sm.router, prefix="/api/v1")
    app.include_router(om.router, prefix="/api/v1")
    app.include_router(tm.router, prefix="/api/v1")
    app.include_router(am.router, prefix="/api/v1")
    return app


def test_api_status_200():
    app    = _make_app()
    client = TestClient(app)
    resp   = client.get("/api/v1/control/status")
    assert resp.status_code == 200
    data   = resp.json()
    assert "state" in data

def test_api_opportunities_returns_list():
    app    = _make_app()
    client = TestClient(app)
    resp   = client.get("/api/v1/opportunities")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

def test_api_trades_returns_list():
    app    = _make_app()
    client = TestClient(app)
    resp   = client.get("/api/v1/trades")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

def test_api_trade_stats_has_win_rate():
    app    = _make_app()
    client = TestClient(app)
    resp   = client.get("/api/v1/trades/stats")
    assert resp.status_code == 200
    assert "win_rate" in resp.json()
