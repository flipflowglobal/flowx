"""
api/server.py
=============
Production FastAPI application factory.
"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from api.routes import status, opportunities, trades, control, ai as ai_routes
from api.websocket import WebSocketBroadcaster


def create_app(config, orchestrator, db) -> FastAPI:
    broadcaster = WebSocketBroadcaster(orchestrator.broadcast_queue)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        import asyncio
        task = asyncio.create_task(broadcaster.run())
        yield
        task.cancel()

    app = FastAPI(
        title="NEXUS-ARB",
        version="2.0.0",
        description="Autonomous DeFi Arbitrage Engine",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def timing_middleware(request: Request, call_next):
        req_id = str(uuid.uuid4())[:8]
        t0     = time.perf_counter()
        resp   = await call_next(request)
        ms     = (time.perf_counter() - t0) * 1000
        resp.headers["X-Request-ID"]    = req_id
        resp.headers["X-Response-Time"] = f"{ms:.1f}ms"
        return resp

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content={"error": type(exc).__name__, "detail": str(exc), "timestamp": int(time.time())},
        )

    # Inject shared state into route modules
    for module in [status, opportunities, trades, control, ai_routes]:
        module.orchestrator = orchestrator
        module.db           = db
        module.config       = config

    # WebSocket broadcaster reference
    import api.websocket as ws_module
    ws_module.broadcaster = broadcaster

    app.include_router(status.router,        prefix="/api/v1")
    app.include_router(opportunities.router, prefix="/api/v1")
    app.include_router(trades.router,        prefix="/api/v1")
    app.include_router(control.router,       prefix="/api/v1")
    app.include_router(ai_routes.router,     prefix="/api/v1")

    # WebSocket endpoint
    from api.websocket import ws_router
    app.include_router(ws_router)

    # Static dashboard
    dash_path = Path(__file__).parent.parent / "dashboard"
    if dash_path.exists():
        app.mount("/", StaticFiles(directory=str(dash_path), html=True), name="dashboard")

    return app
