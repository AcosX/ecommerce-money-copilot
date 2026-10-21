from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> JSONResponse:
    """存活与数据库连通检查。数据库不可用时返回 503。"""
    ok = request.app.state.db.ping()
    return JSONResponse(
        {"status": "ok" if ok else "unavailable", "database": "ok" if ok else "unavailable"},
        status_code=200 if ok else 503,
    )
