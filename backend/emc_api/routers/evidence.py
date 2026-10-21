"""证据附件上传与受控下载路由（#31，契约 §9）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db
from ..errors import NotFound
from ..hashing import sha256_hex
from ..ids import EVIDENCE, has_prefix, new_id
from ..models import EvidenceFile
from ..security import CurrentPlayer, get_app_settings, require_player
from ..services.audit import record_audit
from ..services.idempotency import endpoint_id, idempotency_key, run_idempotent
from ..services.storage import (
    detect_file_type,
    parse_multipart_file,
    read_evidence_file,
    remove_evidence_file,
    sanitize_filename,
    write_evidence_file,
)
from ..timeutil import isoformat_utc, utcnow

router = APIRouter(tags=["evidence"])

_UPLOAD_OPENAPI_EXTRA: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "required": ["file"],
                    "properties": {
                        "file": {
                            "type": "string",
                            "format": "binary",
                            "description": "证据文件（PNG / JPEG / WebP / PDF，≤ 10 MiB）",
                        }
                    },
                }
            }
        },
    }
}


def evidence_to_json(ev: EvidenceFile) -> dict[str, Any]:
    return {
        "id": ev.id,
        "owner_id": ev.owner_id,
        "submission_id": ev.submission_id,
        "original_filename": ev.original_filename,
        "content_type": ev.content_type,
        "size_bytes": ev.size_bytes,
        "sha256": ev.sha256,
        "download_url": f"/api/evidence/{ev.id}/content",
        "created_at": isoformat_utc(ev.created_at),
    }


@router.post("/evidence", status_code=201, openapi_extra=_UPLOAD_OPENAPI_EXTRA)
async def upload_evidence(
    request: Request,
    key: str | None = Depends(idempotency_key),
    player: CurrentPlayer = Depends(require_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """上传单个证据附件（multipart 字段 `file`），按魔数校验类型并落盘到私有目录。"""
    raw_filename, data = await parse_multipart_file(request, settings.max_upload_bytes)
    content_type, ext = detect_file_type(data)
    safe_filename = sanitize_filename(raw_filename, ext)
    file_sha256 = sha256_hex(data)

    written_keys: list[str] = []

    def handler(s: Session) -> tuple[int, dict[str, Any]]:
        while written_keys:
            remove_evidence_file(settings, written_keys.pop())
        now = utcnow()
        ev_id = new_id(EVIDENCE)
        storage_key = write_evidence_file(
            settings,
            evidence_id=ev_id,
            data=data,
            ext=ext,
            now=now,
        )
        written_keys.append(storage_key)
        ev = EvidenceFile(
            id=ev_id,
            owner_id=player.id,
            submission_id=None,
            storage_key=storage_key,
            original_filename=safe_filename,
            content_type=content_type,
            size_bytes=len(data),
            sha256=file_sha256,
            created_at=now,
        )
        s.add(ev)
        record_audit(
            s,
            "evidence.upload",
            actor_player_id=player.id,
            target_type="evidence",
            target_id=ev.id,
            details={
                "content_type": content_type,
                "size_bytes": len(data),
                "sha256": file_sha256,
            },
            now=now,
        )
        s.flush()
        return 201, evidence_to_json(ev)

    try:
        result = run_idempotent(
            db,
            player_id=player.id,
            endpoint=endpoint_id(request),
            key=key,
            request_body={
                "sha256": file_sha256,
                "size_bytes": len(data),
                "filename": safe_filename,
            },
            handler=handler,
        )
    except Exception:
        while written_keys:
            remove_evidence_file(settings, written_keys.pop())
        raise

    return result.to_response()


@router.get("/evidence/{evidence_id}/content")
def download_evidence(
    evidence_id: str,
    player: CurrentPlayer = Depends(require_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> FileResponse:
    """下载证据附件：仅证据归属玩家本人或审核员可读；其他玩家一律 404。"""
    if not has_prefix(evidence_id, EVIDENCE):
        raise NotFound()
    ev = db.get(EvidenceFile, evidence_id)
    if ev is None:
        raise NotFound()
    if ev.owner_id != player.id and not player.is_reviewer:
        raise NotFound()
    path = read_evidence_file(settings, ev.storage_key)
    return FileResponse(
        path,
        media_type=ev.content_type,
        filename=ev.original_filename,
        content_disposition_type="attachment",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
