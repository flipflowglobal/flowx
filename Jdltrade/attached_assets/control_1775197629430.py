"""api/routes/control.py"""
from fastapi import APIRouter
import time

router       = APIRouter()
orchestrator = None
db           = None
config       = None

@router.get("/control/status")
async def status():
    s = orchestrator.get_status() if orchestrator else {"state": "idle"}
    return {**s, "timestamp": int(time.time())}

@router.post("/control/stop")
async def stop():
    return {"message": "Send SIGTERM to process to stop gracefully."}

@router.post("/control/config")
async def update_config(min_profit_usd: float = None, max_gas_gwei: float = None):
    if orchestrator and config:
        if min_profit_usd is not None:
            config.min_profit_usd = min_profit_usd
        if max_gas_gwei is not None:
            config.max_gas_gwei = max_gas_gwei
    return {"message": "Config updated", "timestamp": int(time.time())}
