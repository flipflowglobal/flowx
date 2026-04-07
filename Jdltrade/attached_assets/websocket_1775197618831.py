"""
api/websocket.py
================
Real-time WebSocket broadcaster.
Clients connect to ws://host:port/ws and receive JSON push messages.

Message schema: {type: str, payload: dict, ts: int}
Types: opportunity_scored | trade_executed | circuit_breaker | gas_update | weight_update
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

ws_router   = APIRouter()
broadcaster: Optional["WebSocketBroadcaster"] = None


class WebSocketBroadcaster:
    def __init__(self, queue: asyncio.Queue):
        self._queue   = queue
        self._clients: set[WebSocket] = set()

    async def run(self):
        """Consume broadcast queue and fan out to all connected clients."""
        while True:
            try:
                msg = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                if self._clients:
                    payload = json.dumps(msg)
                    dead    = set()
                    for ws in list(self._clients):
                        try:
                            await ws.send_text(payload)
                        except Exception:
                            dead.add(ws)
                    self._clients -= dead
            except asyncio.TimeoutError:
                # Send heartbeat every ~10s
                if self._clients and int(time.time()) % 10 == 0:
                    hb = json.dumps({"type": "heartbeat", "ts": int(time.time())})
                    dead = set()
                    for ws in list(self._clients):
                        try:
                            await ws.send_text(hb)
                        except Exception:
                            dead.add(ws)
                    self._clients -= dead
            except Exception as exc:
                logger.debug(f"Broadcaster error: {exc}")

    def add_client(self, ws: WebSocket):
        self._clients.add(ws)

    def remove_client(self, ws: WebSocket):
        self._clients.discard(ws)


@ws_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    if broadcaster:
        broadcaster.add_client(websocket)
    try:
        while True:
            # Keep connection alive; client may send pings
            data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong", "ts": int(time.time())}))
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as exc:
        logger.debug(f"WS client error: {exc}")
    finally:
        if broadcaster:
            broadcaster.remove_client(websocket)
