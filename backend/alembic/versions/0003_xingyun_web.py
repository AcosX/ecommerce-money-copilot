"""Scoped Web XingyunAvatarAgent sessions and prepared turns."""

import sqlalchemy as sa

from alembic import op
from emc_api.db import JSONText, UTCDateTime

revision = "0003_xingyun_web"
down_revision = "0002_agent_review_queue"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "xingyun_web_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_id", sa.String(32), sa.ForeignKey("players.id", ondelete="CASCADE")),
        sa.Column("session_id_hash", sa.CHAR(64)),
        sa.Column("expires_at", UTCDateTime(), nullable=False),
        sa.Column("turn", JSONText()),
        sa.CheckConstraint(
            "turn IS NULL OR json_valid(turn)", name=op.f("ck_xingyun_web_sessions_turn_json")
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index("ix_xingyun_web_sessions_expires_at", "xingyun_web_sessions", ["expires_at"])


def downgrade():
    op.drop_table("xingyun_web_sessions")
