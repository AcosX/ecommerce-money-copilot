"""独立游客 AI 会话，不赋予正式业务登录权限。"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_guest_sessions",
        sa.Column("id_hash", sa.CHAR(64), nullable=False),
        sa.Column("player_id", sa.String(32), nullable=False),
        sa.Column("project_id", sa.String(32), nullable=False),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("level", sa.String(16), nullable=False),
        sa.Column("client_hash", sa.CHAR(64), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("expires_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("quota_day", sa.String(10), nullable=False),
        sa.Column("messages_today", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id_hash"),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["business_projects.id"]),
        sa.UniqueConstraint("player_id"),
        sa.UniqueConstraint("project_id"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(
        op.f("ix_agent_guest_sessions_client_hash"), "agent_guest_sessions", ["client_hash"]
    )
    op.create_index(
        op.f("ix_agent_guest_sessions_expires_at"), "agent_guest_sessions", ["expires_at"]
    )


def downgrade() -> None:
    op.drop_table("agent_guest_sessions")
