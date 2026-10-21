"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-21 04:10:33.666985
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("occurred_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("actor_player_id", sa.String(length=32), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("details", mysql.LONGTEXT(), nullable=True),
        sa.CheckConstraint(
            "details IS NULL OR json_valid(details)", name=op.f("ck_audit_events_details_json")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_events")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_audit_events_actor_player_id"), "audit_events", ["actor_player_id"], unique=False
    )
    op.create_index(
        op.f("ix_audit_events_occurred_at"), "audit_events", ["occurred_at"], unique=False
    )
    op.create_index(
        op.f("ix_audit_events_target_type_target_id"),
        "audit_events",
        ["target_type", "target_id"],
        unique=False,
    )
    op.create_table(
        "players",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("acos_sub", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("last_login_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_players")),
        sa.UniqueConstraint("acos_sub", name=op.f("uq_players_acos_sub")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(op.f("ix_players_created_at"), "players", ["created_at"], unique=False)
    op.create_table(
        "business_projects",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("platform", sa.String(length=64), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="active", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'archived')", name=op.f("ck_business_projects_status")
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["players.id"], name=op.f("fk_business_projects_owner_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_business_projects")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_business_projects_owner_id_created_at_id"),
        "business_projects",
        ["owner_id", "created_at", "id"],
        unique=False,
    )
    op.create_table(
        "idempotency_records",
        sa.Column("player_id", sa.String(length=32), nullable=False),
        sa.Column("endpoint", sa.String(length=128), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("response_status", sa.SmallInteger(), nullable=False),
        sa.Column("response_body", mysql.LONGTEXT(), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("expires_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint(
            "response_body IS NULL OR json_valid(response_body)",
            name=op.f("ck_idempotency_records_response_json"),
        ),
        sa.ForeignKeyConstraint(
            ["player_id"],
            ["players.id"],
            name=op.f("fk_idempotency_records_player_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "player_id", "endpoint", "key", name=op.f("pk_idempotency_records")
        ),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_idempotency_records_expires_at"),
        "idempotency_records",
        ["expires_at"],
        unique=False,
    )
    op.create_table(
        "sessions",
        sa.Column("id_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("player_id", sa.String(length=32), nullable=False),
        sa.Column("csrf_token", sa.String(length=64), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("last_seen_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("expires_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("revoked_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.ForeignKeyConstraint(
            ["player_id"], ["players.id"], name=op.f("fk_sessions_player_id"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id_hash", name=op.f("pk_sessions")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(op.f("ix_sessions_expires_at"), "sessions", ["expires_at"], unique=False)
    op.create_index(op.f("ix_sessions_player_id"), "sessions", ["player_id"], unique=False)
    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.String(length=32), nullable=False),
        sa.Column("artifact_type", sa.String(length=32), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="draft", nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("source_level_id", sa.String(length=8), nullable=True),
        sa.Column("current_revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint(
            "origin <> 'tutorial_copy' OR source_level_id IS NOT NULL",
            name=op.f("ck_artifacts_tutorial_source"),
        ),
        sa.CheckConstraint(
            "origin IN ('formal', 'tutorial_copy')", name=op.f("ck_artifacts_origin")
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'submitted', 'approved', 'rejected')",
            name=op.f("ck_artifacts_status"),
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["players.id"], name=op.f("fk_artifacts_owner_id")),
        sa.ForeignKeyConstraint(
            ["project_id"], ["business_projects.id"], name=op.f("fk_artifacts_project_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_artifacts")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_artifacts_owner_id_created_at_id"),
        "artifacts",
        ["owner_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_artifacts_project_id_created_at_id"),
        "artifacts",
        ["project_id", "created_at", "id"],
        unique=False,
    )
    op.create_table(
        "artifact_revisions",
        sa.Column("artifact_id", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("content", mysql.LONGTEXT(), nullable=False),
        sa.Column("content_sha256", sa.CHAR(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=32), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint("json_valid(content)", name=op.f("ck_artifact_revisions_content_json")),
        sa.ForeignKeyConstraint(
            ["artifact_id"], ["artifacts.id"], name=op.f("fk_artifact_revisions_artifact_id")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["players.id"], name=op.f("fk_artifact_revisions_created_by")
        ),
        sa.PrimaryKeyConstraint("artifact_id", "revision", name=op.f("pk_artifact_revisions")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_artifact_revisions_created_by"), "artifact_revisions", ["created_by"], unique=False
    )
    op.create_table(
        "verification_submissions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("artifact_id", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.String(length=32), nullable=False),
        sa.Column("artifact_revision", sa.Integer(), nullable=False),
        sa.Column("snapshot", mysql.LONGTEXT(), nullable=False),
        sa.Column("snapshot_sha256", sa.CHAR(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("method", sa.String(length=32), server_default="manual_review", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("decided_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column(
            "pending_artifact_id",
            sa.String(length=32),
            sa.Computed(
                "CASE WHEN status = 'pending' THEN artifact_id ELSE NULL END", persisted=True
            ),
            nullable=True,
        ),
        sa.CheckConstraint(
            "method IN ('manual_review')", name=op.f("ck_verification_submissions_method")
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name=op.f("ck_verification_submissions_status"),
        ),
        sa.CheckConstraint(
            "json_valid(snapshot)", name=op.f("ck_verification_submissions_snapshot_json")
        ),
        sa.ForeignKeyConstraint(
            ["artifact_id", "artifact_revision"],
            ["artifact_revisions.artifact_id", "artifact_revisions.revision"],
            name="fk_verification_submissions_artifact_revision",
        ),
        sa.ForeignKeyConstraint(
            ["artifact_id"], ["artifacts.id"], name=op.f("fk_verification_submissions_artifact_id")
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["players.id"], name=op.f("fk_verification_submissions_owner_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_verification_submissions")),
        sa.UniqueConstraint(
            "pending_artifact_id", name=op.f("uq_verification_submissions_pending_artifact_id")
        ),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_verification_submissions_artifact_id_artifact_revision"),
        "verification_submissions",
        ["artifact_id", "artifact_revision"],
        unique=False,
    )
    op.create_index(
        op.f("ix_verification_submissions_owner_id_created_at_id"),
        "verification_submissions",
        ["owner_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_verification_submissions_status_created_at_id"),
        "verification_submissions",
        ["status", "created_at", "id"],
        unique=False,
    )
    op.create_table(
        "evidence_files",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.String(length=32), nullable=False),
        sa.Column("submission_id", sa.String(length=32), nullable=True),
        sa.Column("storage_key", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.CHAR(length=64), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["players.id"], name=op.f("fk_evidence_files_owner_id")
        ),
        sa.ForeignKeyConstraint(
            ["submission_id"],
            ["verification_submissions.id"],
            name=op.f("fk_evidence_files_submission_id"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_evidence_files")),
        sa.UniqueConstraint("storage_key", name=op.f("uq_evidence_files_storage_key")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_evidence_files_owner_id_created_at_id"),
        "evidence_files",
        ["owner_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_evidence_files_submission_id"), "evidence_files", ["submission_id"], unique=False
    )
    op.create_table(
        "verification_reviews",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("submission_id", sa.String(length=32), nullable=False),
        sa.Column("reviewer_id", sa.String(length=32), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint(
            "decision IN ('approved', 'rejected')", name=op.f("ck_verification_reviews_decision")
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_id"], ["players.id"], name=op.f("fk_verification_reviews_reviewer_id")
        ),
        sa.ForeignKeyConstraint(
            ["submission_id"],
            ["verification_submissions.id"],
            name=op.f("fk_verification_reviews_submission_id"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_verification_reviews")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_verification_reviews_reviewer_id"),
        "verification_reviews",
        ["reviewer_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_verification_reviews_submission_id"),
        "verification_reviews",
        ["submission_id"],
        unique=False,
    )


def downgrade() -> None:
    # 删除表会一并删除其索引；按外键依赖逆序删除（MariaDB 不允许先删外键所需索引）。
    op.drop_table("verification_reviews")
    op.drop_table("evidence_files")
    op.drop_table("verification_submissions")
    op.drop_table("artifact_revisions")
    op.drop_table("artifacts")
    op.drop_table("sessions")
    op.drop_table("idempotency_records")
    op.drop_table("business_projects")
    op.drop_table("players")
    op.drop_table("audit_events")
