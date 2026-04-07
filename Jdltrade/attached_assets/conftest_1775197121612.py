"""tests/conftest.py — Pytest fixtures for NEXUS-ARB"""
import pytest
from web3 import Web3

@pytest.fixture(scope="session")
def w3_fork():
    w3 = Web3(Web3.HTTPProvider("http://127.0.0.1:8545"))
    if not w3.is_connected():
        pytest.skip("Hardhat fork not running. Start: npx hardhat node --fork $ETH_RPC_URL")
    return w3

@pytest.fixture
def dummy_config():
    class C:
        min_profit_usd = 5.0
        max_loan_usd   = 50000.0
        min_loan_usd   = 500.0
        max_gas_gwei   = 50.0
        slippage_bps   = 50
        scan_interval_ms = 500
        max_concurrent_routes = 30
        flash_receiver_address = "0x" + "00"*20
        active = type('A', (), {
            'chain_id': 1, 'weth': "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            'uniswap_v3_quoter_v2': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
            'uniswap_v3_factory':   "0x1F98431c8aD98523631AE4a59f267346ea31F984",
            'balancer_vault':       "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
            'multicall3':           "0xcA11bde05977b3631167028862bE2a173976CA11",
        })()
    return C()
