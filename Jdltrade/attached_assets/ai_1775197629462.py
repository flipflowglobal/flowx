"""api/routes/ai.py"""
from fastapi import APIRouter

router       = APIRouter()
orchestrator = None
db           = None
config       = None

@router.get("/ai/weights")
async def engine_weights():
    row = await db.get_latest_engine_weights()
    if not row:
        return {"ppo": 0.25, "thompson": 0.25, "ukf": 0.25, "cma_es": 0.25}
    return row

@router.get("/ai/engines")
async def engine_status():
    brain = orchestrator.brain if orchestrator else None
    if not brain:
        return {}
    return {"weights": brain.weights, "history_size": len(brain._pred_history)}

@router.get("/ai/kelly")
async def kelly_status():
    cb = orchestrator.circuit_breaker if orchestrator else None
    if not cb:
        return {}
    f = cb.compute_kelly_fraction()
    return {
        "kelly_fraction": f,
        "circuit_breaker_state": cb.state,
        "recommended_loan_usd": cb.get_recommended_loan_size(
            [], config.max_loan_usd if config else 10000
        ),
    }

@router.get("/ai/cma-params")
async def cma_params():
    brain = orchestrator.brain if orchestrator else None
    if not brain:
        return {}
    return brain._engines["cma_es"].get_best_params()
