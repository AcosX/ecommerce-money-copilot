-- 生产/测试环境最小权限账号示例（MariaDB 10.11 Galera）。由 DBA 以管理员身份执行；
-- 密码为占位符，请替换后执行，不要提交真实密码。
--
-- emc_migrate：仅用于 `alembic upgrade`（部署时）。
-- emc_app：运行时账号；只追加表（审计、审核记录、成果版本）只授予 SELECT/INSERT。
-- 表级授权要求表已存在：先执行迁移，再执行本脚本；以后新增表需补充授权。

CREATE DATABASE IF NOT EXISTS emc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'emc_migrate'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_MIGRATE';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON emc.* TO 'emc_migrate'@'127.0.0.1';

CREATE USER IF NOT EXISTS 'emc_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_APP';
GRANT SELECT, INSERT, UPDATE, DELETE ON emc.players TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON emc.sessions TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON emc.business_projects TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON emc.artifacts TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT ON emc.artifact_revisions TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON emc.evidence_files TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON emc.verification_submissions TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT ON emc.verification_reviews TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT ON emc.audit_events TO 'emc_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON emc.idempotency_records TO 'emc_app'@'127.0.0.1';
GRANT SELECT ON emc.alembic_version TO 'emc_app'@'127.0.0.1';
