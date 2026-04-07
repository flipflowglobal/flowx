"""api/routes/opportunities.py"""
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
import asyncio, json, time

router       = APIRouter()
orchestrator = None
db           = None
config       = None

@router.get("/opportunities")
async def list_opportunities(limit: int = 100, min_score: float = 0.0):
    return await db.get_recent_opportunities(limit=limit, min_score=min_score)

@router.get("/opportunities/{opp_id}")
async def get_opportunity(opp_id: int):
    rows = await db.get_recent_opportunities(limit=1000)
    match = next((r for r in rows if r.get("id") == opp_id), None)
    if not match:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    return match
