"""伙伴活动计时和完整耐心区间。

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_agent_states_patience"), "agent_states", type_="check")
    op.create_check_constraint(
        op.f("ck_agent_states_patience"), "agent_states", "patience BETWEEN 0 AND 100"
    )
    op.create_table(
        "agent_engagements",
        sa.Column("project_id", sa.String(32), nullable=False),
        sa.Column("level", sa.String(16), nullable=False),
        sa.Column("progress_token", sa.CHAR(64), nullable=False),
        sa.Column("active_seconds", sa.Integer(), nullable=False),
        sa.Column("stagnant_seconds", sa.Integer(), nullable=False),
        sa.Column("last_seen_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.PrimaryKeyConstraint("project_id"),
        sa.ForeignKeyConstraint(["project_id"], ["business_projects.id"]),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )


def downgrade() -> None:
    op.drop_table("agent_engagements")
    op.execute("UPDATE agent_states SET patience = 25 WHERE patience < 25")
    op.drop_constraint(op.f("ck_agent_states_patience"), "agent_states", type_="check")
    op.create_check_constraint(
        op.f("ck_agent_states_patience"), "agent_states", "patience BETWEEN 25 AND 100"
    )
