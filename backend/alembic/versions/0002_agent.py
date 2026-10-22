"""项目级 Agent 状态与回合。

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

OPTIONS = dict(mysql_engine="InnoDB", mysql_charset="utf8mb4", mysql_collate="utf8mb4_unicode_ci")


def upgrade() -> None:
    op.create_table(
        "agent_states",
        sa.Column("project_id", sa.String(32), nullable=False),
        sa.Column("affinity", sa.Integer(), nullable=False),
        sa.Column("patience", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("memory", mysql.LONGTEXT(), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.PrimaryKeyConstraint("project_id"),
        sa.ForeignKeyConstraint(["project_id"], ["business_projects.id"]),
        sa.CheckConstraint("affinity BETWEEN 0 AND 100", name="affinity"),
        sa.CheckConstraint("patience BETWEEN 25 AND 100", name="patience"),
        sa.CheckConstraint("json_valid(memory)", name="memory_json"),
        **OPTIONS,
    )
    op.create_table(
        "agent_turns",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("project_id", sa.String(32), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("response", mysql.LONGTEXT(), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["project_id"], ["business_projects.id"]),
        sa.UniqueConstraint("project_id", "sequence"),
        sa.CheckConstraint("json_valid(response)", name="response_json"),
        **OPTIONS,
    )


def downgrade() -> None:
    op.drop_table("agent_turns")
    op.drop_table("agent_states")
