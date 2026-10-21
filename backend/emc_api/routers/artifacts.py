"""正式成果与不可变版本历史接口（契约 §7、§8、§9，#24、#25、#26、#27、#28）。"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db, with_retry
from ..errors import InvalidState, NotFound, ValidationFailed, VersionConflict
from ..hashing import json_sha256
from ..ids import ARTIFACT, PROJECT, has_prefix, new_id
from ..models import ARTIFACT_STATUSES, Artifact, ArtifactRevision, BusinessProject
from ..pagination import PageParams, page_params, paginate
from ..security import CurrentPlayer, require_player
from ..services.artifact_types import (
    ALLOWED_ARTIFACT_TYPES,
    ALLOWED_LEVEL_IDS,
    ARTIFACT_TYPE_TO_LEVEL,
    origin_label,
    validate_artifact_content,
)
from ..services.audit import record_audit
from ..services.idempotency import endpoint_id, idempotency_key, run_idempotent
from ..timeutil import isoformat_utc, utcnow

router = APIRouter(tags=["artifacts"])

_EDITABLE_STATUSES = frozenset({"draft", "rejected"})
_UPDATABLE_FIELDS = frozenset({"title", "content"})


def artifact_summary_to_json(artifact: Artifact) -> dict[str, Any]:
    return {
        "id": artifact.id,
        "project_id": artifact.project_id,
        "owner_id": artifact.owner_id,
        "artifact_type": artifact.artifact_type,
        "level_id": ARTIFACT_TYPE_TO_LEVEL.get(artifact.artifact_type),
        "schema_version": artifact.schema_version,
        "title": artifact.title,
        "status": artifact.status,
        "origin": artifact.origin,
        "origin_label": origin_label(artifact.origin),
        "source_level_id": artifact.source_level_id,
        "current_revision": artifact.current_revision,
        "version": artifact.version,
        "created_at": isoformat_utc(artifact.created_at),
        "updated_at": isoformat_utc(artifact.updated_at),
    }


def artifact_detail_to_json(artifact: Artifact, revision: ArtifactRevision) -> dict[str, Any]:
    data = artifact_summary_to_json(artifact)
    data["content"] = revision.content
    data["content_sha256"] = revision.content_sha256
    return data


def revision_to_json(revision: ArtifactRevision) -> dict[str, Any]:
    return {
        "artifact_id": revision.artifact_id,
        "revision": revision.revision,
        "content": revision.content,
        "content_sha256": revision.content_sha256,
        "created_by": revision.created_by,
        "created_at": isoformat_utc(revision.created_at),
    }


def _strip_required_title(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("必须为字符串")
    stripped = value.strip()
    if not (1 <= len(stripped) <= 200):
        raise ValueError("成果标题长度须为 1–200 字符")
    return stripped


class ArtifactCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str
    artifact_type: str
    schema_version: StrictInt = Field(default=1, ge=1)
    title: str
    content: dict[str, Any]
    origin: Literal["formal", "tutorial_copy"] = "formal"
    source_level_id: str | None = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str) -> str:
        return _strip_required_title(value)


class ArtifactUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: StrictInt = Field(ge=1)
    title: str | None = None
    content: dict[str, Any] | None = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _strip_required_title(value)


@router.get("/artifacts")
def list_artifacts(
    page: PageParams = Depends(page_params),
    project_id: str | None = Query(None),
    artifact_type: str | None = Query(None),
    status: str | None = Query(None),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if status is not None and status not in ARTIFACT_STATUSES:
        raise ValidationFailed.field(["query", "status"], "不支持的成果状态")
    if artifact_type is not None and artifact_type not in ALLOWED_ARTIFACT_TYPES:
        raise ValidationFailed.field(["query", "artifact_type"], "不支持的成果类型")
    if project_id is not None:
        if not has_prefix(project_id, PROJECT):
            raise NotFound()
        project = db.get(BusinessProject, project_id)
        if project is None or project.owner_id != player.id:
            raise NotFound()

    stmt = select(Artifact).where(Artifact.owner_id == player.id)
    if project_id is not None:
        stmt = stmt.where(Artifact.project_id == project_id)
    if artifact_type is not None:
        stmt = stmt.where(Artifact.artifact_type == artifact_type)
    if status is not None:
        stmt = stmt.where(Artifact.status == status)

    result = paginate(
        db,
        stmt,
        page=page,
        created_col=Artifact.created_at,
        id_col=Artifact.id,
    )
    return result.to_dict(artifact_summary_to_json)


@router.post("/artifacts", status_code=201)
def create_artifact(
    body: ArtifactCreateIn,
    request: Request,
    key: str | None = Depends(idempotency_key),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> JSONResponse:
    if body.artifact_type not in ALLOWED_ARTIFACT_TYPES:
        raise ValidationFailed.field(
            ["body", "artifact_type"], f"不支持的成果类型: {body.artifact_type}"
        )
    if body.origin == "tutorial_copy":
        if body.source_level_id is None or body.source_level_id not in ALLOWED_LEVEL_IDS:
            raise ValidationFailed.field(
                ["body", "source_level_id"],
                "从教学模拟复制成果时必须提供合法的 source_level_id (L1-L6)",
            )
    elif body.source_level_id is not None and body.source_level_id not in ALLOWED_LEVEL_IDS:
        raise ValidationFailed.field(["body", "source_level_id"], "source_level_id 必须为 L1-L6")

    validated_content = validate_artifact_content(
        body.artifact_type, body.schema_version, body.content
    )

    def handler(s: Session) -> tuple[int, dict[str, Any]]:
        if not has_prefix(body.project_id, PROJECT):
            raise NotFound()
        project = s.execute(
            select(BusinessProject).where(BusinessProject.id == body.project_id).with_for_update()
        ).scalar_one_or_none()
        if project is None or project.owner_id != player.id:
            raise NotFound()
        if project.status != "active":
            raise InvalidState("归档项目不能新增成果")

        now = utcnow()
        content_hash = json_sha256(validated_content)
        # 无论来自正式创建还是教学模拟复制，初始状态一律为 draft，绝不直接变为认证通过。
        artifact = Artifact(
            id=new_id(ARTIFACT),
            project_id=project.id,
            owner_id=player.id,
            artifact_type=body.artifact_type,
            schema_version=body.schema_version,
            title=body.title,
            status="draft",
            origin=body.origin,
            source_level_id=body.source_level_id,
            current_revision=1,
            version=1,
            created_at=now,
            updated_at=now,
        )
        s.add(artifact)
        s.flush()

        revision = ArtifactRevision(
            artifact_id=artifact.id,
            revision=1,
            content=validated_content,
            content_sha256=content_hash,
            created_by=player.id,
            created_at=now,
        )
        s.add(revision)
        record_audit(
            s,
            "artifact.create",
            actor_player_id=player.id,
            target_type="artifact",
            target_id=artifact.id,
            details={
                "project_id": project.id,
                "artifact_type": artifact.artifact_type,
                "origin": artifact.origin,
                "source_level_id": artifact.source_level_id,
            },
            now=now,
        )
        s.flush()
        return 201, artifact_detail_to_json(artifact, revision)

    return run_idempotent(
        db,
        player_id=player.id,
        endpoint=endpoint_id(request),
        key=key,
        request_body=body.model_dump(mode="json"),
        handler=handler,
    ).to_response()


@router.get("/artifacts/{artifact_id}")
def get_artifact(
    artifact_id: str,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not has_prefix(artifact_id, ARTIFACT):
        raise NotFound()
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.owner_id != player.id:
        raise NotFound()
    revision = db.get(ArtifactRevision, (artifact.id, artifact.current_revision))
    if revision is None:
        raise NotFound()
    return artifact_detail_to_json(artifact, revision)


@router.patch("/artifacts/{artifact_id}")
def update_artifact(
    artifact_id: str,
    body: ArtifactUpdateIn,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    fields_set = body.model_fields_set
    if not (fields_set & _UPDATABLE_FIELDS):
        raise ValidationFailed.field(["body"], "至少提供 title 或 content")
    if "title" in fields_set and body.title is None:
        raise ValidationFailed.field(["body", "title"], "title 不能为空")
    if "content" in fields_set and body.content is None:
        raise ValidationFailed.field(["body", "content"], "content 不能为空")
    if not has_prefix(artifact_id, ARTIFACT):
        raise NotFound()

    def work(s: Session) -> dict[str, Any]:
        artifact = s.execute(
            select(Artifact).where(Artifact.id == artifact_id).with_for_update()
        ).scalar_one_or_none()
        if artifact is None or artifact.owner_id != player.id:
            raise NotFound()
        if artifact.status not in _EDITABLE_STATUSES:
            raise InvalidState("当前成果状态不允许修改")
        if artifact.version != body.version:
            raise VersionConflict(details={"current_version": artifact.version})

        current_rev = s.get(ArtifactRevision, (artifact.id, artifact.current_revision))
        assert current_rev is not None

        now = utcnow()
        if "title" in fields_set:
            assert body.title is not None
            artifact.title = body.title

        active_rev = current_rev
        if "content" in fields_set:
            assert body.content is not None
            validated_content = validate_artifact_content(
                artifact.artifact_type, artifact.schema_version, body.content
            )
            new_sha = json_sha256(validated_content)
            if new_sha != current_rev.content_sha256:
                artifact.current_revision += 1
                active_rev = ArtifactRevision(
                    artifact_id=artifact.id,
                    revision=artifact.current_revision,
                    content=validated_content,
                    content_sha256=new_sha,
                    created_by=player.id,
                    created_at=now,
                )
                s.add(active_rev)

        if artifact.status == "rejected":
            artifact.status = "draft"

        artifact.version += 1
        artifact.updated_at = now
        record_audit(
            s,
            "artifact.update",
            actor_player_id=player.id,
            target_type="artifact",
            target_id=artifact.id,
            details={
                "version": artifact.version,
                "revision": artifact.current_revision,
                "status": artifact.status,
            },
            now=now,
        )
        s.flush()
        return artifact_detail_to_json(artifact, active_rev)

    return with_retry(db, work)


@router.get("/artifacts/{artifact_id}/revisions")
def list_artifact_revisions(
    artifact_id: str,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not has_prefix(artifact_id, ARTIFACT):
        raise NotFound()
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.owner_id != player.id:
        raise NotFound()
    revisions = db.scalars(
        select(ArtifactRevision)
        .where(ArtifactRevision.artifact_id == artifact.id)
        .order_by(ArtifactRevision.revision.desc())
    ).all()
    return {"items": [revision_to_json(r) for r in revisions]}
