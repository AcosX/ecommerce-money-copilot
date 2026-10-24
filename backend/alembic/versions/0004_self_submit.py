"""Submission is immediately approved; AI feedback is advisory only."""

import sqlalchemy as sa

from alembic import op

revision = "0004_self_submit"
down_revision = "0003_xingyun_web"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(
        op.f("ck_verification_submissions_method"), "verification_submissions", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_verification_submissions_method"),
        "verification_submissions",
        "method IN ('manual_review', 'agent_review', 'self_submit')",
    )
    # Existing waiting players are released too. Keep frozen snapshots and files.
    op.execute(
        sa.text(
            "UPDATE verification_submissions SET status='approved', "
            "decided_at=UTC_TIMESTAMP(6) WHERE status='pending'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE artifacts a JOIN verification_submissions s ON s.artifact_id=a.id "
            "AND s.artifact_revision=a.current_revision SET a.status='approved', "
            "a.version=a.version+1 WHERE a.status='submitted' AND s.status='approved'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE review_jobs SET status='queued', attempts=0, "
            "next_attempt_at=UTC_TIMESTAMP(6), lease_token=NULL, lease_until=NULL "
            "WHERE status IN ('waiting_manual','leased')"
        )
    )


def downgrade():
    # Retain approvals when rolling back.
    op.execute(
        sa.text(
            "UPDATE verification_submissions SET method='agent_review' WHERE method='self_submit'"
        )
    )
    op.drop_constraint(
        op.f("ck_verification_submissions_method"), "verification_submissions", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_verification_submissions_method"),
        "verification_submissions",
        "method IN ('manual_review', 'agent_review')",
    )
