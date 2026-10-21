from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..security import CurrentPlayer, get_current_player

router = APIRouter(tags=["me"])


@router.get("/me")
def read_me(current: CurrentPlayer | None = Depends(get_current_player)) -> dict[str, Any]:
    """当前玩家；游客或会话失效时返回匿名态（契约 §5）。"""
    if current is None:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "player": {
            "id": current.id,
            "display_name": current.display_name,
            "email": current.email,
        },
        "roles": current.roles,
        "csrf_token": current.csrf_token,
    }
