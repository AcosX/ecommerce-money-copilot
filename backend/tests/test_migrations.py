"""迁移：空库升级、模型一致性、降级到 base、Galera 兼容性、pending 唯一约束。"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL, Engine
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from emc_api import ids
from emc_api.db import is_check_constraint_error, is_duplicate_key_error
from emc_api.hashing import json_sha256
from emc_api.models import (
    Artifact,
    ArtifactRevision,
    Base,
    BusinessProject,
    Player,
    VerificationSubmission,
)
from emc_api.timeutil import utcnow

from .conftest import alembic_config, create_test_database, drop_test_database, url_string

EXPECTED_TABLES = {
    "agent_guest_sessions",
    "agent_engagements",
    "agent_states",
    "agent_turns",
    "players",
    "sessions",
    "business_projects",
    "artifacts",
    "artifact_revisions",
    "evidence_files",
    "verification_submissions",
    "verification_reviews",
    "audit_events",
    "idempotency_records",
}


@pytest.fixture
def empty_db() -> Iterator[tuple[URL, Engine]]:
    url = create_test_database(prefix="emc_test_mig_")
    engine = create_engine(url_string(url))
    try:
        yield url, engine
    finally:
        engine.dispose()
        drop_test_database(url)


def table_names(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_upgrade_from_empty_and_downgrade_to_base(empty_db) -> None:
    url, engine = empty_db
    cfg = alembic_config(url)
    assert table_names(engine) == set()

    command.upgrade(cfg, "head")
    assert table_names(engine) == EXPECTED_TABLES | {"alembic_version"}
    command.check(cfg)  # 模型与迁移无差异

    command.downgrade(cfg, "base")
    assert table_names(engine) == {"alembic_version"}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM alembic_version")).scalar() == 0

    command.upgrade(cfg, "head")
    assert table_names(engine) == EXPECTED_TABLES | {"alembic_version"}


def test_models_cover_expected_tables_without_tutorial() -> None:
    assert set(Base.metadata.tables) == EXPECTED_TABLES
    assert not any("tutorial" in name for name in Base.metadata.tables)


def test_galera_compatible_schema(database, database_url) -> None:
    with database.engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT t.TABLE_NAME, t.ENGINE, t.TABLE_COLLATION, "
                "  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS c "
                "    WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME "
                "      AND c.CONSTRAINT_TYPE = 'PRIMARY KEY') AS pk "
                "FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = :db"
            ),
            {"db": database_url.database},
        ).all()
        assert {r[0] for r in rows} == EXPECTED_TABLES | {"alembic_version"}
        for name, engine_name, collation, pk in rows:
            assert engine_name == "InnoDB", name
            assert collation == "utf8mb4_unicode_ci", name
            assert pk == 1, f"{name} has no primary key"

        bad_columns = conn.execute(
            text(
                "SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME "
                "FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = :db AND CHARACTER_SET_NAME IS NOT NULL "
                "AND CHARACTER_SET_NAME <> 'utf8mb4'"
            ),
            {"db": database_url.database},
        ).all()
        assert bad_columns == []


def test_utf8mb4_roundtrip(db_session: Session) -> None:
    player = Player(
        id=ids.new_id(ids.PLAYER), acos_sub="emoji", display_name="店主🛒𠀀", created_at=utcnow()
    )
    db_session.add(player)
    db_session.commit()
    db_session.expire_all()
    assert db_session.get(Player, player.id).display_name == "店主🛒𠀀"


# ---------------------------------------------------------------- pending 唯一约束


def make_artifact(db: Session) -> tuple[Player, Artifact]:
    now = utcnow()
    player = Player(
        id=ids.new_id(ids.PLAYER), acos_sub=ids.new_id(ids.PLAYER), display_name="x", created_at=now
    )
    project = BusinessProject(
        id=ids.new_id(ids.PROJECT), owner_id=player.id, name="p", created_at=now, updated_at=now
    )
    artifact = Artifact(
        id=ids.new_id(ids.ARTIFACT),
        project_id=project.id,
        owner_id=player.id,
        artifact_type="business_plan",
        schema_version=1,
        title="t",
        origin="formal",
        created_at=now,
        updated_at=now,
    )
    content = {"goal": "第一单"}
    revision = ArtifactRevision(
        artifact_id=artifact.id,
        revision=1,
        content=content,
        content_sha256=json_sha256(content),
        created_by=player.id,
        created_at=now,
    )
    db.add(player)
    db.flush()
    db.add(project)
    db.flush()
    db.add(artifact)
    db.flush()
    db.add(revision)
    db.commit()
    return player, artifact


def make_submission(
    db: Session, player: Player, artifact: Artifact, status: str = "pending"
) -> VerificationSubmission:
    snapshot = {"content": {"goal": "第一单"}}
    submission = VerificationSubmission(
        id=ids.new_id(ids.VERIFICATION),
        artifact_id=artifact.id,
        owner_id=player.id,
        artifact_revision=1,
        snapshot=snapshot,
        snapshot_sha256=json_sha256(snapshot),
        status=status,
        created_at=utcnow(),
    )
    db.add(submission)
    db.flush()
    return submission


def test_one_pending_submission_per_artifact(db_session: Session) -> None:
    player, artifact = make_artifact(db_session)
    first = make_submission(db_session, player, artifact)
    db_session.commit()
    db_session.refresh(first)
    assert first.pending_artifact_id == artifact.id

    with pytest.raises(IntegrityError) as excinfo:
        make_submission(db_session, player, artifact)
    assert is_duplicate_key_error(excinfo.value)
    db_session.rollback()

    first.status = "rejected"
    first.decided_at = utcnow()
    db_session.commit()
    db_session.refresh(first)
    assert first.pending_artifact_id is None

    second = make_submission(db_session, player, artifact)  # 驳回后可再次提交
    make_submission(db_session, player, artifact, status="approved")  # 终态可有多条
    db_session.commit()
    assert second.status == "pending"


def test_pending_constraint_independent_per_artifact(db_session: Session) -> None:
    player, a1 = make_artifact(db_session)
    _, a2 = make_artifact(db_session)
    make_submission(db_session, player, a1)
    make_submission(db_session, player, a2)
    db_session.commit()


def test_invalid_json_rejected_by_check_constraint(db_session: Session) -> None:
    player, artifact = make_artifact(db_session)
    with pytest.raises(DBAPIError) as excinfo:
        db_session.execute(
            text(
                "INSERT INTO artifact_revisions (artifact_id, revision, content, content_sha256, "
                "created_by, created_at) VALUES (:a, 2, '{not json', :h, :p, NOW(6))"
            ),
            {"a": artifact.id, "h": "0" * 64, "p": player.id},
        )
    assert is_check_constraint_error(excinfo.value)
    db_session.rollback()


def test_tutorial_copy_requires_source_level(db_session: Session) -> None:
    _, artifact = make_artifact(db_session)
    with pytest.raises(DBAPIError) as excinfo:
        db_session.execute(
            text(
                "UPDATE artifacts SET origin = 'tutorial_copy', source_level_id = NULL "
                "WHERE id = :id"
            ),
            {"id": artifact.id},
        )
    assert is_check_constraint_error(excinfo.value)
    db_session.rollback()
