"""api/routes/trades.py"""
from fastapi import APIRouter
router       = APIRouter()
orchestrator = None
db           = None
config       = None

@router.get("/trades")
async def list_trades(limit: int = 100):
    return await db.get_recent_trades(limit=limit)

@router.get("/trades/stats")
async def trade_stats():
    return await db.get_trade_stats()
