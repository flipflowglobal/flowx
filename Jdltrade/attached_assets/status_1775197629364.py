"""api/routes/status.py"""
from fastapi import APIRouter
import time

router      = APIRouter()
orchestrator = None
db           = None
config       = None

@router.get("/control/status")
async def get_status():
    stats  = await db.get_trade_stats()
    status = orchestrator.get_status() if orchestrator else {"state": "idle"}
    return {**status, "trade_stats": stats, "timestamp": int(time.time())}
