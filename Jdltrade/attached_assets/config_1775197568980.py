"""
core/config.py
==============
Environment-driven configuration with full on-chain address registry.
Raises ConfigurationError with the exact missing variable name on startup.
All addresses checksummed at load time via Web3.to_checksum_address.
"""

from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field
from typing import Optional
from web3 import Web3

logger = logging.getLogger(__name__)


class ConfigurationError(Exception):
    """Raised when a required environment variable is absent or invalid."""


def _require(name: str) -> str:
    val = os.getenv(name, "").strip()
    if not val:
        raise ConfigurationError(
            f"Required environment variable '{name}' is not set. "
            f"Copy .env.example to .env and fill in all required values."
        )
    return val


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _checksum(addr: str, name: str) -> str:
    try:
        return Web3.to_checksum_address(addr)
    except Exception:
        raise ConfigurationError(f"Invalid Ethereum address for {name}: '{addr}'")


@dataclass
class ChainConfig:
    chain_id: int
    rpc_urls: list[str]
    ws_urls: list[str]
    aave_pool: str
    aave_provider: str
    uniswap_v3_router: str
    uniswap_v3_quoter_v2: str
    uniswap_v3_factory: str
    balancer_vault: str
    multicall3: str
    chainlink_eth_usd: str
    weth: str
    usdc: str
    usdt: str
    dai: str
    wbtc: str
    steth: str
    reth: str
    block_time_ms: int


@dataclass
class Config:
    ethereum: ChainConfig
    arbitrum: ChainConfig
    active_chain: str
    active: ChainConfig = field(init=False)

    # Trading
    deployer_private_key: str = field(repr=False)
    flash_receiver_address: str = ""
    min_profit_usd: float = 5.0
    max_loan_usd: float = 50_000.0
    min_loan_usd: float = 500.0
    max_gas_gwei: float = 50.0
    slippage_bps: int = 50
    scan_interval_ms: int = 500
    max_concurrent_routes: int = 30

    # System
    db_path: str = "nexus_arb.db"
    api_host: str = "0.0.0.0"
    api_port: int = 8420
    log_level: str = "INFO"

    def __post_init__(self):
        if self.active_chain == "arbitrum":
            self.active = self.arbitrum
        else:
            self.active = self.ethereum


def load_config(active_chain: str = "ethereum") -> Config:
    from dotenv import load_dotenv
    load_dotenv()

    # ── Ethereum mainnet ──────────────────────────────────────────────────────
    eth_rpc_primary = _optional("ETH_RPC_URL")
    eth_rpc_backup  = _optional("ETH_RPC_URLS_BACKUP", "")
    eth_ws          = _optional("ETH_WS_URLS", "")

    eth_rpc_list = [u.strip() for u in (eth_rpc_primary + "," + eth_rpc_backup).split(",") if u.strip()]
    eth_ws_list  = [u.strip() for u in eth_ws.split(",") if u.strip()]

    if not eth_rpc_list:
        raise ConfigurationError("At least one Ethereum RPC URL required (ETH_RPC_URL)")

    ethereum = ChainConfig(
        chain_id            = 1,
        rpc_urls            = eth_rpc_list,
        ws_urls             = eth_ws_list,
        aave_pool           = _checksum("0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",  "aave_pool_eth"),
        aave_provider       = _checksum("0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",  "aave_provider_eth"),
        uniswap_v3_router   = _checksum("0xE592427A0AEce92De3Edee1F18E0157C05861564",  "univ3_router"),
        uniswap_v3_quoter_v2= _checksum("0x61fFE014bA17989E743c5F6cB21bF9697530B21e",  "univ3_quoter"),
        uniswap_v3_factory  = _checksum("0x1F98431c8aD98523631AE4a59f267346ea31F984",  "univ3_factory"),
        balancer_vault      = _checksum("0xBA12222222228d8Ba445958a75a0704d566BF2C8",  "balancer_vault"),
        multicall3          = _checksum("0xcA11bde05977b3631167028862bE2a173976CA11",  "multicall3"),
        chainlink_eth_usd   = _checksum("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",  "chainlink_eth_usd"),
        weth                = _checksum("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",  "weth"),
        usdc                = _checksum("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",  "usdc"),
        usdt                = _checksum("0xdAC17F958D2ee523a2206206994597C13D831ec7",  "usdt"),
        dai                 = _checksum("0x6B175474E89094C44Da98b954EedeAC495271d0F",  "dai"),
        wbtc                = _checksum("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",  "wbtc"),
        steth               = _checksum("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",  "steth"),
        reth                = _checksum("0xae78736Cd615f374D3085123A210448E74Fc6393",  "reth"),
        block_time_ms       = 12_000,
    )

    # ── Arbitrum One ──────────────────────────────────────────────────────────
    arb_rpc_primary = _optional("ARB_RPC_URL", "")
    arb_rpc_backup  = _optional("ARB_RPC_URLS_BACKUP", "")
    arb_ws          = _optional("ARB_WS_URLS", "")

    arb_rpc_list = [u.strip() for u in (arb_rpc_primary + "," + arb_rpc_backup).split(",") if u.strip()]
    arb_ws_list  = [u.strip() for u in arb_ws.split(",") if u.strip()]

    arbitrum = ChainConfig(
        chain_id            = 42161,
        rpc_urls            = arb_rpc_list or ["https://arb1.arbitrum.io/rpc"],
        ws_urls             = arb_ws_list,
        aave_pool           = _checksum("0x794a61358D6845594F94dc1DB02A252b5b4814aD",  "aave_pool_arb"),
        aave_provider       = _checksum("0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",  "aave_provider_arb"),
        uniswap_v3_router   = _checksum("0xE592427A0AEce92De3Edee1F18E0157C05861564",  "univ3_router_arb"),
        uniswap_v3_quoter_v2= _checksum("0x61fFE014bA17989E743c5F6cB21bF9697530B21e",  "univ3_quoter_arb"),
        uniswap_v3_factory  = _checksum("0x1F98431c8aD98523631AE4a59f267346ea31F984",  "univ3_factory_arb"),
        balancer_vault      = _checksum("0xBA12222222228d8Ba445958a75a0704d566BF2C8",  "balancer_vault_arb"),
        multicall3          = _checksum("0xcA11bde05977b3631167028862bE2a173976CA11",  "multicall3_arb"),
        chainlink_eth_usd   = _checksum("0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",  "chainlink_eth_usd_arb"),
        weth                = _checksum("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",  "weth_arb"),
        usdc                = _checksum("0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  "usdc_arb"),
        usdt                = _checksum("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",  "usdt_arb"),
        dai                 = _checksum("0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",  "dai_arb"),
        wbtc                = _checksum("0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",  "wbtc_arb"),
        steth               = _checksum("0x0000000000000000000000000000000000000000",  "steth_arb"),  # not on Arb
        reth                = _checksum("0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA",   "reth_arb"),
        block_time_ms       = 250,
    )

    private_key = _require("DEPLOYER_PRIVATE_KEY")

    flash_receiver = _optional("FLASH_RECEIVER_ADDRESS", "")
    if flash_receiver:
        flash_receiver = _checksum(flash_receiver, "flash_receiver_address")

    cfg = Config(
        ethereum              = ethereum,
        arbitrum              = arbitrum,
        active_chain          = active_chain,
        deployer_private_key  = private_key,
        flash_receiver_address= flash_receiver,
        min_profit_usd        = float(_optional("MIN_PROFIT_USD",  "5.0")),
        max_loan_usd          = float(_optional("MAX_LOAN_USD",    "50000.0")),
        min_loan_usd          = float(_optional("MIN_LOAN_USD",    "500.0")),
        max_gas_gwei          = float(_optional("MAX_GAS_GWEI",    "50.0")),
        slippage_bps          = int(_optional(  "SLIPPAGE_BPS",    "50")),
        scan_interval_ms      = int(_optional(  "SCAN_INTERVAL_MS","500")),
        max_concurrent_routes = int(_optional(  "MAX_ROUTES",      "30")),
        db_path               = _optional("DB_PATH",   "nexus_arb.db"),
        api_host              = _optional("API_HOST",  "0.0.0.0"),
        api_port              = int(_optional("API_PORT", "8420")),
        log_level             = _optional("LOG_LEVEL", "INFO"),
    )

    logger.info(
        f"Config loaded: chain={active_chain} min_profit=${cfg.min_profit_usd} "
        f"max_loan=${cfg.max_loan_usd} max_gas={cfg.max_gas_gwei}gwei"
    )
    return cfg
