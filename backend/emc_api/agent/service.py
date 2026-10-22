"""Agent 的数据库边界：项目所有权、真实业务状态、持久化。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import InvalidState, NotFound
from ..hashing import json_sha256
from ..models import (
    AgentEngagement,
    AgentGuestSession,
    AgentState,
    Artifact,
    ArtifactRevision,
    BusinessProject,
)
from ..services.artifact_types import LEVEL_TO_ARTIFACT_TYPE
from ..timeutil import utcnow
from .contracts import CompanionState
from .emotion import DEFAULT_POLICY, EmotionPolicy, emotion_profile, performance_effects

TASKS = [
    ("生意规划", "先告诉我预算、货源、每周时间和意向平台。"),
    ("选品落地", "先列候选商品、参考来源、需求与成本。"),
    ("素材优化", "先选定商品、使用场景和需要优化的素材。"),
    ("自动化上架", "先核对价格、库存、规格和配送。"),
    ("内容生成发布", "先明确顾客、场景与有依据的卖点。"),
    ("数据复盘", "先核对数据来源、时间范围与已尝试的调整。"),
]


def owned_project(db: Session, project_id: str, owner_id: str, *, lock: bool = False):
    stmt = select(BusinessProject).where(
        BusinessProject.id == project_id, BusinessProject.owner_id == owner_id
    )
    if lock:
        stmt = stmt.with_for_update()
    project = db.scalar(stmt.execution_options(populate_existing=True))
    if project is None:
        raise NotFound()
    return project


def business_context(db: Session, project: BusinessProject) -> dict:
    guest = db.scalar(select(AgentGuestSession).where(AgentGuestSession.project_id == project.id))
    if guest is not None:
        name, hint = (
            TASKS[int(guest.level[1:]) - 1]
            if guest.level != "first_order"
            else ("真实第一单", "先准备真实订单证据。")
        )
        return {
            "project_id": project.id,
            "platform": project.platform,
            "category": project.category,
            "level": guest.level,
            "task_name": name,
            "status": "tutorial",
            "hint": hint,
            "mode": "guest-teaching",
        }
    artifacts = list(
        db.scalars(
            select(Artifact)
            .where(Artifact.project_id == project.id, Artifact.owner_id == project.owner_id)
            .order_by(Artifact.created_at.desc(), Artifact.id.desc())
        )
    )
    for index, (level, kind) in enumerate(LEVEL_TO_ARTIFACT_TYPE.items()):
        candidates = [a for a in artifacts if a.artifact_type == kind]
        if not any(a.status == "approved" for a in candidates):
            name, hint = TASKS[index]
            return {
                "project_id": project.id,
                "platform": project.platform,
                "category": project.category,
                "level": level,
                "task_name": name,
                "status": candidates[0].status if candidates else "ready",
                "hint": hint,
            }
    return {
        "project_id": project.id,
        "platform": project.platform,
        "category": project.category,
        "level": "first_order",
        "task_name": "真实第一单",
        "status": "not_certified",
        "hint": "准备真实订单证据，等待首单核验能力开放。",
    }


def progress_token(db: Session, project: BusinessProject, level: str) -> str:
    rows = db.execute(
        select(Artifact.status, ArtifactRevision.content_sha256)
        .join(
            ArtifactRevision,
            (Artifact.id == ArtifactRevision.artifact_id)
            & (Artifact.current_revision == ArtifactRevision.revision),
        )
        .where(
            Artifact.project_id == project.id,
            Artifact.owner_id == project.owner_id,
            Artifact.artifact_type == LEVEL_TO_ARTIFACT_TYPE.get(level),
        )
        .order_by(Artifact.status, ArtifactRevision.content_sha256)
    ).all()
    return json_sha256(sorted({tuple(r) for r in rows}))


def performance_view(db: Session, project_id: str, context: dict) -> dict:
    row = db.get(AgentEngagement, project_id)
    project = db.get(BusinessProject, project_id)
    token = progress_token(db, project, context["level"]) if project else None
    if row is None or row.level != context["level"]:
        return {"paused": context["status"] == "submitted", "progress_token": token}
    return {
        "active_seconds": row.active_seconds,
        "stagnant_seconds": row.stagnant_seconds if token == row.progress_token else 0,
        "progress_token": token,
        "paused": context["status"] == "submitted",
    }


def tick_activity(
    db: Session, project: BusinessProject, context: dict, *, reset_clock: bool = False
) -> None:
    now = utcnow()
    token = progress_token(db, project, context["level"])
    row = db.get(AgentEngagement, project.id)
    if row is None:
        row = AgentEngagement(
            project_id=project.id,
            level=context["level"],
            progress_token=token,
            active_seconds=0,
            stagnant_seconds=0,
            last_seen_at=now,
        )
        db.add(row)
        db.flush()
        return
    if row.level != context["level"]:
        row.level, row.active_seconds, row.stagnant_seconds = context["level"], 0, 0
    elif context["status"] != "submitted":
        gap = (now - row.last_seen_at).total_seconds()
        # 大间隔代表后台、掉线或休息，不能把这段时间当作浪费。
        elapsed = int(gap) if not reset_clock and 0 < gap <= 90 else 0
        row.active_seconds += elapsed
        row.stagnant_seconds += elapsed
    if row.progress_token != token:
        row.stagnant_seconds = 0
    row.progress_token, row.last_seen_at = token, now
    db.flush()


def state_view(
    row: AgentState | None,
    level: str,
    performance: dict | None = None,
    policy: EmotionPolicy = DEFAULT_POLICY,
) -> CompanionState:
    memory = row.memory if row else {}
    affinity, patience = (row.affinity, row.patience) if row else (20, 80)
    reasons = memory.get("last_change", {}).get("reason_codes", [])
    if performance is not None:
        affinity, patience, memory, projected = performance_effects(
            affinity, patience, memory, level, performance, policy
        )
        reasons = projected or reasons
    return CompanionState(
        affinity=affinity,
        patience=patience,
        version=row.version if row else 1,
        level=level,
        streak=memory.get("streak", 0),
        perks=memory.get("perks", []),
        emotion=emotion_profile(affinity, patience, performance, reasons, policy),
    )


def require_active(project: BusinessProject) -> None:
    if project.status != "active":
        raise InvalidState("归档项目不能发起新的伙伴对话")
