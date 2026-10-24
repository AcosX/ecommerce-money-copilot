"""Durable, bounded review worker. No LLM call is made while holding DB locks."""

from __future__ import annotations

import argparse
import json
import secrets
import time
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import Database
from ..models import Artifact, ReviewJob, VerificationSubmission
from ..timeutil import utcnow
from .audit import record_audit
from .deliverable_review import RUBRIC_VERSION, ReviewUnavailable, review_submission

MAX_ATTEMPTS = 4


def enqueue(db: Session, settings: Settings, sub: VerificationSubmission) -> None:
    db.add(
        ReviewJob(
            submission_id=sub.id,
            snapshot_sha256=sub.snapshot_sha256,
            rubric_version=RUBRIC_VERSION,
            model=settings.ai_review_model,
        )
    )


def claim(db: Session) -> tuple[str, str] | None:
    now = utcnow()
    job = db.scalar(
        select(ReviewJob)
        .where(
            or_(
                and_(ReviewJob.status.in_(("queued", "retry")), ReviewJob.next_attempt_at <= now),
                and_(ReviewJob.status == "leased", ReviewJob.lease_until <= now),
            )
        )
        .order_by(ReviewJob.next_attempt_at, ReviewJob.submission_id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if not job:
        db.rollback()
        return None
    if job.attempts >= MAX_ATTEMPTS:
        job.status = "completed"
        job.last_error = "attempt_limit"
        db.commit()
        return None
    token = secrets.token_hex(24)
    job.status = "leased"
    job.attempts += 1
    job.lease_token = token
    job.lease_until = now + timedelta(seconds=120)
    job.updated_at = now
    identifier = job.submission_id
    db.commit()
    return identifier, token


def run_one(database: Database, settings: Settings) -> bool:
    with database.sessionmaker() as db:
        claimed = claim(db)
    if not claimed:
        return False
    identifier, token = claimed
    report: dict[str, Any] | None = None
    error = None
    with database.sessionmaker() as db:
        sub = db.get(VerificationSubmission, identifier)
        job = db.get(ReviewJob, identifier)
        if sub and sub.status == "approved" and sub.snapshot_sha256 == job.snapshot_sha256:
            try:
                if job.rubric_version != RUBRIC_VERSION:
                    raise ReviewUnavailable("rubric_version_unavailable")
                report = review_submission(db, settings, sub, model=job.model)
            except ReviewUnavailable as exc:
                error = str(exc)
            except Exception:
                error = "review_internal_error"
    with database.sessionmaker() as db:
        # Keep a consistent lock order (submission -> artifact -> job).
        sub = db.scalar(
            select(VerificationSubmission)
            .where(VerificationSubmission.id == identifier)
            .with_for_update()
        )
        artifact = db.scalar(
            select(Artifact).where(Artifact.id == sub.artifact_id).with_for_update()
        )
        job = db.scalar(
            select(ReviewJob).where(ReviewJob.submission_id == identifier).with_for_update()
        )
        if job.status != "leased" or job.lease_token != token or job.lease_until <= utcnow():
            return True
        now = utcnow()
        job.updated_at = now
        job.lease_token = None
        job.lease_until = None
        # Stale jobs and newer revisions never overwrite submitted outcomes.
        if (
            sub.status != "approved"
            or sub.snapshot_sha256 != job.snapshot_sha256
            or artifact.current_revision != sub.artifact_revision
            or artifact.owner_id != sub.owner_id
        ):
            job.status = "completed"
            job.last_error = "superseded"
        elif error or report is None:
            job.last_error = error or "missing_report"
            terminal_error = job.attempts >= MAX_ATTEMPTS or error in (
                "pdf_needs_manual_review",
                "pdf_unreadable",
                "image_unreadable",
                "evidence_integrity",
                "snapshot_integrity",
                "rubric_version_unavailable",
            )
            job.status = "completed" if terminal_error else "retry"
            job.next_attempt_at = now + timedelta(seconds=30 * 2 ** (job.attempts - 1))
            record_audit(
                db,
                "verification.agent_retry",
                target_type="verification",
                target_id=sub.id,
                details={"error": job.last_error, "attempt": job.attempts, "state": job.status},
            )
        else:
            job.last_error = None
            job.report = report
            # Advisory feedback never changes a submitted outcome.
            job.status = "completed"
            record_audit(
                db,
                "verification.ai_review",
                target_type="verification",
                target_id=sub.id,
                details=report,
            )
        db.commit()
    return True


def metrics(db: Session) -> dict[str, Any]:
    rows = db.execute(select(ReviewJob.status, func.count()).group_by(ReviewJob.status)).all()
    oldest = db.scalar(
        select(func.min(ReviewJob.created_at)).where(
            ReviewJob.status.in_(("queued", "retry", "leased"))
        )
    )
    return {"states": dict(rows), "oldest_pending_at": oldest.isoformat() if oldest else None}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--metrics", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    database = Database(settings.database_url.get_secret_value())
    try:
        if args.metrics:
            with database.sessionmaker() as db:
                print(json.dumps(metrics(db)))
            return
        while True:
            processed = run_one(database, settings)
            if args.once:
                break
            if not processed:
                time.sleep(5)
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
