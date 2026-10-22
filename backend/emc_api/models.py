"""SQLAlchemy 2.x 模型（契约 §10，不含教学进度表）。

MariaDB 10.11 Galera：每张表有主键、InnoDB、utf8mb4_unicode_ci；JSON 存 LONGTEXT + json_valid 检查；
时间为 DATETIME(6) UTC。修改模型后必须新增 Alembic 迁移（tests/test_migrations.py 会比对差异）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CHAR,
    BigInteger,
    CheckConstraint,
    Computed,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from .db import JSONText, UTCDateTime
from .timeutil import utcnow

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}

TABLE_OPTIONS = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_unicode_ci",
}

ID = String(32)
SHA256 = CHAR(64)

PROJECT_STATUSES = ("active", "archived")
ARTIFACT_STATUSES = ("draft", "submitted", "approved", "rejected")
ARTIFACT_ORIGINS = ("formal", "tutorial_copy")
SUBMISSION_STATUSES = ("pending", "approved", "rejected")
SUBMISSION_METHODS = ("manual_review",)
REVIEW_DECISIONS = ("approved", "rejected")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Player(Base):
    __tablename__ = "players"
    __table_args__ = (TABLE_OPTIONS,)

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    acos_sub: Mapped[str] = mapped_column(String(255), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class SessionRecord(Base):
    """服务端会话。主键是会话 ID 的 SHA-256（hex），原始会话 ID 只存在于 Cookie 中。"""

    __tablename__ = "sessions"
    __table_args__ = (TABLE_OPTIONS,)

    id_hash: Mapped[str] = mapped_column(SHA256, primary_key=True)
    player_id: Mapped[str] = mapped_column(
        ID, ForeignKey("players.id", ondelete="CASCADE"), index=True
    )
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime())
    # 绝对过期时间（created_at + EMC_SESSION_ABSOLUTE_SECONDS）
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class BusinessProject(Base):
    __tablename__ = "business_projects"
    __table_args__ = (
        CheckConstraint(_in("status", PROJECT_STATUSES), name="status"),
        Index(None, "owner_id", "created_at", "id"),
        TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    owner_id: Mapped[str] = mapped_column(ID, ForeignKey("players.id"))
    name: Mapped[str] = mapped_column(String(80))
    platform: Mapped[str | None] = mapped_column(String(64))
    category: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (
        CheckConstraint(_in("status", ARTIFACT_STATUSES), name="status"),
        CheckConstraint(_in("origin", ARTIFACT_ORIGINS), name="origin"),
        CheckConstraint(
            "origin <> 'tutorial_copy' OR source_level_id IS NOT NULL", name="tutorial_source"
        ),
        Index(None, "owner_id", "created_at", "id"),
        Index(None, "project_id", "created_at", "id"),
        TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    project_id: Mapped[str] = mapped_column(ID, ForeignKey("business_projects.id"))
    owner_id: Mapped[str] = mapped_column(ID, ForeignKey("players.id"))
    artifact_type: Mapped[str] = mapped_column(String(32))
    schema_version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default="draft", server_default="draft")
    origin: Mapped[str] = mapped_column(String(16))
    source_level_id: Mapped[str | None] = mapped_column(String(8))
    current_revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class ArtifactRevision(Base):
    """成果内容的不可变版本（只追加）。"""

    __tablename__ = "artifact_revisions"
    __table_args__ = (
        CheckConstraint("json_valid(content)", name="content_json"),
        TABLE_OPTIONS,
    )

    artifact_id: Mapped[str] = mapped_column(ID, ForeignKey("artifacts.id"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    content: Mapped[Any] = mapped_column(JSONText())
    content_sha256: Mapped[str] = mapped_column(SHA256)
    created_by: Mapped[str] = mapped_column(ID, ForeignKey("players.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class VerificationSubmission(Base):
    __tablename__ = "verification_submissions"
    __table_args__ = (
        CheckConstraint(_in("status", SUBMISSION_STATUSES), name="status"),
        CheckConstraint(_in("method", SUBMISSION_METHODS), name="method"),
        CheckConstraint("json_valid(snapshot)", name="snapshot_json"),
        ForeignKeyConstraint(
            ["artifact_id", "artifact_revision"],
            ["artifact_revisions.artifact_id", "artifact_revisions.revision"],
            name="fk_verification_submissions_artifact_revision",
        ),
        # 同一成果最多一个 pending：pending_artifact_id 仅在 pending 时等于 artifact_id，
        # 其余状态为 NULL（唯一索引允许多个 NULL）。
        UniqueConstraint("pending_artifact_id"),
        Index(None, "artifact_id", "artifact_revision"),
        Index(None, "owner_id", "created_at", "id"),
        Index(None, "status", "created_at", "id"),
        TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    artifact_id: Mapped[str] = mapped_column(ID, ForeignKey("artifacts.id"))
    owner_id: Mapped[str] = mapped_column(ID, ForeignKey("players.id"))
    artifact_revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[Any] = mapped_column(JSONText())
    snapshot_sha256: Mapped[str] = mapped_column(SHA256)
    note: Mapped[str | None] = mapped_column(Text)
    method: Mapped[str] = mapped_column(
        String(32), default="manual_review", server_default="manual_review"
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    pending_artifact_id: Mapped[str | None] = mapped_column(
        ID,
        Computed("CASE WHEN status = 'pending' THEN artifact_id ELSE NULL END", persisted=True),
    )


class EvidenceFile(Base):
    __tablename__ = "evidence_files"
    __table_args__ = (Index(None, "owner_id", "created_at", "id"), TABLE_OPTIONS)

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    owner_id: Mapped[str] = mapped_column(ID, ForeignKey("players.id"))
    submission_id: Mapped[str | None] = mapped_column(
        ID, ForeignKey("verification_submissions.id"), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(SHA256)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class VerificationReview(Base):
    """审核记录（只追加）。"""

    __tablename__ = "verification_reviews"
    __table_args__ = (
        CheckConstraint(_in("decision", REVIEW_DECISIONS), name="decision"),
        TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    submission_id: Mapped[str] = mapped_column(
        ID, ForeignKey("verification_submissions.id"), index=True
    )
    reviewer_id: Mapped[str] = mapped_column(ID, ForeignKey("players.id"), index=True)
    decision: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class AuditEvent(Base):
    """审计事件（只追加）。不设外键，玩家记录变化不影响审计留存。"""

    __tablename__ = "audit_events"
    __table_args__ = (
        CheckConstraint("details IS NULL OR json_valid(details)", name="details_json"),
        Index(None, "target_type", "target_id"),
        TABLE_OPTIONS,
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    actor_player_id: Mapped[str | None] = mapped_column(ID, index=True)
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(64))
    request_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[Any | None] = mapped_column(JSONText())


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (
        CheckConstraint("response_body IS NULL OR json_valid(response_body)", name="response_json"),
        TABLE_OPTIONS,
    )

    player_id: Mapped[str] = mapped_column(
        ID, ForeignKey("players.id", ondelete="CASCADE"), primary_key=True
    )
    endpoint: Mapped[str] = mapped_column(String(128), primary_key=True)
    # 列名 `key` 为保留字，SQLAlchemy 会自动加引号；Python 侧属性名为 idem_key。
    idem_key: Mapped[str] = mapped_column("key", String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(SHA256)
    response_status: Mapped[int] = mapped_column(SmallInteger)
    response_body: Mapped[Any | None] = mapped_column(JSONText())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)


APPEND_ONLY_MODELS: tuple[type[Base], ...] = (AuditEvent, VerificationReview, ArtifactRevision)


class AppendOnlyViolation(RuntimeError):
    pass


@event.listens_for(Session, "before_flush")
def _guard_append_only(session: Session, flush_context: object, instances: object) -> None:
    """ORM 层禁止修改/删除只追加的记录。

    数据库层另由最小权限账号保证（见 sql/grants.example.sql）。
    """
    for obj in session.deleted:
        if isinstance(obj, APPEND_ONLY_MODELS):
            raise AppendOnlyViolation(f"{type(obj).__name__} is append-only")
    for obj in session.dirty:
        if isinstance(obj, APPEND_ONLY_MODELS) and session.is_modified(obj):
            raise AppendOnlyViolation(f"{type(obj).__name__} is append-only")


__all__ = [
    "APPEND_ONLY_MODELS",
    "AppendOnlyViolation",
    "Artifact",
    "ArtifactRevision",
    "AuditEvent",
    "Base",
    "BusinessProject",
    "EvidenceFile",
    "IdempotencyRecord",
    "Player",
    "SessionRecord",
    "VerificationReview",
    "VerificationSubmission",
]
