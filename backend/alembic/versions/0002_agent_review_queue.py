"""Persistent Agent review jobs and attributed formal review reports."""

import sqlalchemy as sa

from alembic import op
from emc_api.db import JSONText, UTCDateTime

revision = "0002_agent_review_queue"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(
        op.f("ck_verification_submissions_method"), "verification_submissions", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_verification_submissions_method"),
        "verification_submissions",
        "method IN ('manual_review', 'agent_review')",
    )
    op.alter_column(
        "verification_reviews", "reviewer_id", existing_type=sa.String(32), nullable=True
    )
    op.add_column(
        "verification_reviews",
        sa.Column("source", sa.String(16), nullable=False, server_default="manual"),
    )
    op.add_column("verification_reviews", sa.Column("report", JSONText(), nullable=True))
    op.create_table(
        "review_jobs",
        sa.Column(
            "submission_id",
            sa.String(32),
            sa.ForeignKey("verification_submissions.id"),
            primary_key=True,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", UTCDateTime(), nullable=False),
        sa.Column("lease_until", UTCDateTime()),
        sa.Column("lease_token", sa.String(64)),
        sa.Column("snapshot_sha256", sa.CHAR(64), nullable=False),
        sa.Column("rubric_version", sa.String(32), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("last_error", sa.String(128)),
        sa.Column("report", JSONText()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued','leased','retry','waiting_manual','completed')",
            name=op.f("ck_review_jobs_status"),
        ),
        sa.CheckConstraint(
            "report IS NULL OR json_valid(report)", name=op.f("ck_review_jobs_report_json")
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(
        "ix_review_jobs_status_next_attempt_at", "review_jobs", ["status", "next_attempt_at"]
    )


def downgrade():
    # Never erase Agent decisions or invent human reviewer identities on rollback.
    bind = op.get_bind()
    if bind.execute(
        sa.text("SELECT COUNT(*) FROM verification_reviews WHERE reviewer_id IS NULL")
    ).scalar():
        raise RuntimeError(
            "Agent reviews exist; keep the additive migration when rolling back application code"
        )
    op.drop_table("review_jobs")
    op.drop_column("verification_reviews", "report")
    op.drop_column("verification_reviews", "source")
    op.alter_column(
        "verification_reviews", "reviewer_id", existing_type=sa.String(32), nullable=False
    )
    bind.execute(
        sa.text(
            "UPDATE verification_submissions SET method='manual_review' WHERE method='agent_review'"
        )
    )
    op.drop_constraint(
        op.f("ck_verification_submissions_method"), "verification_submissions", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_verification_submissions_method"),
        "verification_submissions",
        "method IN ('manual_review')",
    )
