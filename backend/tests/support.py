"""测试专用路由（仅在测试中通过 app_factory 挂载，前缀 /api/_t）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from emc_api.db import get_db
from emc_api.errors import InvalidState
from emc_api.ids import PROJECT, new_id
from emc_api.models import BusinessProject
from emc_api.pagination import PageParams, page_params, paginate
from emc_api.security import CurrentPlayer, require_player, require_reviewer
from emc_api.services.audit import record_audit
from emc_api.services.idempotency import endpoint_id, idempotency_key, run_idempotent
from emc_api.timeutil import isoformat_utc, utcnow

router = APIRouter(prefix="/_t")


class EchoIn(BaseModel):
    name: str = Field(min_length=1, max_length=10)
    count: int = 0


class ThingIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.post("/echo")
def echo(body: EchoIn) -> dict[str, Any]:
    return body.model_dump()


@router.post("/raw")
async def raw(request: Request) -> dict[str, int]:
    return {"size": len(await request.body())}


@router.post("/evidence-like")
async def evidence_like(request: Request) -> dict[str, int]:
    return {"size": len(await request.body())}


@router.get("/boom")
def boom() -> None:
    raise RuntimeError("secret-internal-detail")


@router.get("/private")
def private(player: CurrentPlayer = Depends(require_player)) -> dict[str, str]:
    return {"id": player.id}


@router.get("/reviewer")
def reviewer_only(player: CurrentPlayer = Depends(require_reviewer)) -> dict[str, str]:
    return {"id": player.id}


def project_json(project: BusinessProject) -> dict[str, Any]:
    return {"id": project.id, "name": project.name, "created_at": isoformat_utc(project.created_at)}


@router.get("/things")
def list_things(
    page: PageParams = Depends(page_params),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    stmt = select(BusinessProject).where(BusinessProject.owner_id == player.id)
    result = paginate(
        db, stmt, page=page, created_col=BusinessProject.created_at, id_col=BusinessProject.id
    )
    return result.to_dict(project_json)


def _create_thing(
    body: ThingIn,
    request: Request,
    key: str | None,
    player: CurrentPlayer,
    db: Session,
) -> JSONResponse:
    def handler(s: Session) -> tuple[int, dict[str, Any]]:
        if body.name == "fail":
            raise InvalidState()
        now = utcnow()
        project = BusinessProject(
            id=new_id(PROJECT),
            owner_id=player.id,
            name=body.name,
            created_at=now,
            updated_at=now,
        )
        s.add(project)
        record_audit(
            s,
            "project.create",
            actor_player_id=player.id,
            target_type="project",
            target_id=project.id,
            details={"name": body.name},
        )
        s.flush()
        return 201, project_json(project)

    return run_idempotent(
        db,
        player_id=player.id,
        endpoint=endpoint_id(request),
        key=key,
        request_body=body.model_dump(mode="json"),
        handler=handler,
    ).to_response()


@router.post("/things", status_code=201)
def create_thing(
    body: ThingIn,
    request: Request,
    key: str | None = Depends(idempotency_key),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> JSONResponse:
    return _create_thing(body, request, key, player, db)


@router.post("/other-things", status_code=201)
def create_other_thing(
    body: ThingIn,
    request: Request,
    key: str | None = Depends(idempotency_key),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> JSONResponse:
    return _create_thing(body, request, key, player, db)
