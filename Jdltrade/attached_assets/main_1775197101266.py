#!/usr/bin/env python3
"""
NEXUS-ARB v2 — Main Entry Point
================================
Usage:
    python3 main.py                        # live mainnet
    python3 main.py --chain arbitrum       # Arbitrum One
    python3 main.py --dry-run              # score but never send tx
    python3 main.py --scan-only            # scan + AI, no execution
    python3 main.py --api-only             # API + dashboard only
    python3 main.py --log-level DEBUG      # verbose logging
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal

import click
from rich.console import Console
from rich.panel   import Panel
from rich.text    import Text

console = Console()


@click.command()
@click.option("--chain",      default="ethereum",
              type=click.Choice(["ethereum","arbitrum"]),
              help="Target chain")
@click.option("--dry-run",    is_flag=True, default=False,
              help="Score but never send transactions")
@click.option("--scan-only",  is_flag=True, default=False,
              help="Scan + AI only, no execution")
@click.option("--api-only",   is_flag=True, default=False,
              help="API server only, no scanning")
@click.option("--log-level",  default="INFO",
              type=click.Choice(["DEBUG","INFO","WARNING","ERROR"]))
def main(chain, dry_run, scan_only, api_only, log_level):
    """NEXUS-ARB v2 — Autonomous DeFi Arbitrage Engine"""

    logging.basicConfig(
        level=getattr(logging, log_level),
        format="%(asctime)s %(name)-24s %(levelname)-8s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    mode = "DRY-RUN" if dry_run else "SCAN-ONLY" if scan_only else "API-ONLY" if api_only else "LIVE"
    t = Text()
    t.append("NEXUS-ARB ", style="bold green")
    t.append("v2.0\n", style="bold cyan")
    t.append(f"Chain : {chain.upper()}\n", style="dim")
    t.append(f"Mode  : {mode}\n", style="yellow" if mode != "LIVE" else "bold green")
    console.print(Panel(t, border_style="green"))

    if mode == "LIVE":
        console.print("[bold red]⚠  LIVE MODE — Real funds at risk. Ctrl+C to stop.[/bold red]")

    from dotenv import load_dotenv
    load_dotenv()

    from core.config import load_config
    config = load_config(active_chain=chain)

    asyncio.run(_run(config, dry_run, scan_only, api_only))


async def _run(config, dry_run: bool, scan_only: bool, api_only: bool):
    from core.web3_manager   import Web3Manager
    from core.gas_oracle      import GasOracle
    from core.multicall       import MulticallExecutor
    from core.wallet          import Wallet
    from scanner.pool_registry   import PoolRegistry
    from scanner.price_fetcher   import PriceFetcher
    from scanner.route_finder    import RouteFinder
    from scanner.opportunity_scorer import OpportunityScorer
    from scanner.mempool_watcher import MempoolWatcher
    from executor.flash_loan     import FlashLoanExecutor
    from executor.circuit_breaker import CircuitBreaker
    from executor.execution_router import ExecutionRouter
    from executor.tx_monitor     import TxMonitor
    from ai.ppo_engine           import PPOEngine
    from ai.thompson_engine      import ThompsonEngine
    from ai.ukf_engine           import UKFEngine
    from ai.cma_es_engine        import CMAESEngine
    from ai.composite_brain      import CompositeBrain
    from ai.memory_store         import PrioritizedReplayBuffer
    from database.db_manager     import DatabaseManager
    from engine.orchestrator     import NexusOrchestrator
    from api.server              import create_app

    import uvicorn

    # ── Database ──────────────────────────────────────────────────────────────
    db = DatabaseManager(config.db_path)
    await db.initialize()

    # ── Web3 stack ────────────────────────────────────────────────────────────
    w3m  = Web3Manager(config.active.rpc_urls, config.active.ws_urls)
    gas  = GasOracle(w3m)
    mc   = MulticallExecutor(w3m, config.active.multicall3)

    # ── Scanner ───────────────────────────────────────────────────────────────
    registry = PoolRegistry(w3m, mc, config)
    fetcher  = PriceFetcher(w3m, mc, config)
    fetcher._gas = gas   # inject for context
    finder   = RouteFinder(config)
    mw       = MempoolWatcher(w3m, config)
    scorer   = OpportunityScorer(fetcher, gas, config, mempool_watcher=mw)

    # ── AI layer ──────────────────────────────────────────────────────────────
    ppo      = PPOEngine(db)
    thompson = ThompsonEngine(db)
    ukf      = UKFEngine(db)
    cma_es   = CMAESEngine(db)
    replay   = PrioritizedReplayBuffer(db)
    brain    = CompositeBrain(ppo, thompson, ukf, cma_es, replay, db)

    # ── Executor ──────────────────────────────────────────────────────────────
    cb     = CircuitBreaker(db, config)
    router = ExecutionRouter(config)
    txmon  = TxMonitor(w3m)
    flash  = FlashLoanExecutor(w3m, gas, cb, config)

    # ── Orchestrator ──────────────────────────────────────────────────────────
    orch = NexusOrchestrator(
        config=config, db=db,
        pool_registry=registry, price_fetcher=fetcher,
        route_finder=finder, scorer=scorer, brain=brain,
        flash_executor=flash, execution_router=router,
        tx_monitor=txmon, circuit_breaker=cb,
        dry_run=dry_run, scan_only=scan_only,
    )

    # ── API ───────────────────────────────────────────────────────────────────
    app = create_app(config, orch, db)

    # ── Shutdown ──────────────────────────────────────────────────────────────
    shutdown = asyncio.Event()
    loop     = asyncio.get_running_loop()

    def _sig():
        console.print("\n[yellow]Shutdown signal — stopping gracefully…[/yellow]")
        shutdown.set()

    for s in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(s, _sig)

    # ── Start tasks ───────────────────────────────────────────────────────────
    mw.start()

    tasks = []
    if not api_only:
        tasks.append(asyncio.create_task(orch.run(shutdown)))

    uv_cfg = uvicorn.Config(
        app, host=config.api_host, port=config.api_port,
        log_level="warning", access_log=False,
    )
    server = uvicorn.Server(uv_cfg)
    tasks.append(asyncio.create_task(server.serve()))

    console.print(
        f"[green]✓ Dashboard:[/green] http://{config.api_host}:{config.api_port}\n"
        f"[green]✓ API:[/green]       http://{config.api_host}:{config.api_port}/api/v1/control/status"
    )

    await shutdown.wait()

    mw.stop()
    server.should_exit = True
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await db.close()
    console.print("[green]NEXUS-ARB stopped.[/green]")


if __name__ == "__main__":
    main()
