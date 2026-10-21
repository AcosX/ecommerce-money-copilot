"""经营项目接口（契约 §9，#23、#27、#28）。"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db, with_retry
from ..errors import NotFound, ValidationFailed, VersionConflict
from ..ids import PROJECT, has_prefix, new_id
from ..models import PROJECT_STATUSES, BusinessProject
from ..pagination import PageParams, page_params, paginate
from ..security import CurrentPlayer, require_player
from ..services.audit import record_audit
from ..services.idempotency import endpoint_id, idempotency_key, run_idempotent
from ..timeutil import isoformat_utc, utcnow

router = APIRouter(tags=["projects"])

_UPDATABLE_FIELDS = frozenset({"name", "platform", "category", "description", "status"})


def project_to_json(project: BusinessProject) -> dict[str, Any]:
    return {
        "id": project.id,
        "owner_id": project.owner_id,
        "name": project.name,
        "platform": project.platform,
        "category": project.category,
        "description": project.description,
        "status": project.status,
        "version": project.version,
        "created_at": isoformat_utc(project.created_at),
        "updated_at": isoformat_utc(project.updated_at),
    }


def _strip_required_name(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("必须为字符串")
    stripped = value.strip()
    if not (1 <= len(stripped) <= 80):
        raise ValueError("项目名称长度须为 1–80 字符")
    return stripped


def _strip_optional_short(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("必须为字符串")
    stripped = value.strip()
    if len(stripped) > 64:
        raise ValueError("长度不能超过 64 字符")
    return stripped


class ProjectCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    platform: str | None = None
    category: str | None = None
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return _strip_required_name(value)

    @field_validator("platform", "category")
    @classmethod
    def _validate_short(cls, value: str | None) -> str | None:
        return _strip_optional_short(value)


class ProjectUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: StrictInt = Field(ge=1)
    name: str | None = None
    platform: str | None = None
    category: str | None = None
    description: str | None = Field(default=None, max_length=2000)
    status: Literal["active", "archived"] | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _strip_required_name(value)

    @field_validator("platform", "category")
    @classmethod
    def _validate_short(cls, value: str | None) -> str | None:
        return _strip_optional_short(value)


@router.get("/projects")
def list_projects(
    page: PageParams = Depends(page_params),
    status: str | None = Query(None),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if status is not None and status not in PROJECT_STATUSES:
        raise ValidationFailed.field(["query", "status"], "status 必须为 active 或 archived")
    stmt = select(BusinessProject).where(BusinessProject.owner_id == player.id)
    if status is not None:
        stmt = stmt.where(BusinessProject.status == status)
    result = paginate(
        db,
        stmt,
        page=page,
        created_col=BusinessProject.created_at,
        id_col=BusinessProject.id,
    )
    return result.to_dict(project_to_json)


@router.post("/projects", status_code=201)
def create_project(
    body: ProjectCreateIn,
    request: Request,
    key: str | None = Depends(idempotency_key),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> JSONResponse:
    def handler(s: Session) -> tuple[int, dict[str, Any]]:
        now = utcnow()
        project = BusinessProject(
            id=new_id(PROJECT),
            owner_id=player.id,
            name=body.name,
            platform=body.platform,
            category=body.category,
            description=body.description,
            status="active",
            version=1,
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
            details={"name": project.name},
            now=now,
        )
        s.flush()
        return 201, project_to_json(project)

    return run_idempotent(
        db,
        player_id=player.id,
        endpoint=endpoint_id(request),
        key=key,
        request_body=body.model_dump(mode="json"),
        handler=handler,
    ).to_response()


@router.get("/projects/{project_id}")
def get_project(
    project_id: str,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not has_prefix(project_id, PROJECT):
        raise NotFound()
    project = db.get(BusinessProject, project_id)
    if project is None or project.owner_id != player.id:
        raise NotFound()
    return project_to_json(project)


@router.patch("/projects/{project_id}")
def update_project(
    project_id: str,
    body: ProjectUpdateIn,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    fields_set = body.model_fields_set
    if not (fields_set & _UPDATABLE_FIELDS):
        raise ValidationFailed.field(["body"], "至少提供一个要修改的字段")
    if "name" in fields_set and body.name is None:
        raise ValidationFailed.field(["body", "name"], "name 不能为空")
    if "status" in fields_set and body.status is None:
        raise ValidationFailed.field(["body", "status"], "status 不能为空")
    if not has_prefix(project_id, PROJECT):
        raise NotFound()

    def work(s: Session) -> dict[str, Any]:
        project = s.execute(
            select(BusinessProject).where(BusinessProject.id == project_id).with_for_update()
        ).scalar_one_or_none()
        if project is None or project.owner_id != player.id:
            raise NotFound()
        if project.version != body.version:
            raise VersionConflict(details={"current_version": project.version})

        now = utcnow()
        if "name" in fields_set:
            assert body.name is not None
            project.name = body.name
        if "platform" in fields_set:
            project.platform = body.platform
        if "category" in fields_set:
            project.category = body.category
        if "description" in fields_set:
            project.description = body.description
        if "status" in fields_set:
            assert body.status is not None
            project.status = body.status

        project.version += 1
        project.updated_at = now
        record_audit(
            s,
            "project.update",
            actor_player_id=player.id,
            target_type="project",
            target_id=project.id,
            details={"version": project.version},
            now=now,
        )
        s.flush()
        return project_to_json(project)

    return with_retry(db, work)
