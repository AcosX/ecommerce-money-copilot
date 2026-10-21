# 运维手册：测试/演示环境（VM3）

本文说明 `https://money.acosx.top` 的拓扑、部署、回滚、备份恢复与监控。仓库内 `deploy/` 只包含模板与脚本，不含任何凭据。

## 1. 环境

| 环境 | 地址 | 代码来源 | 数据库 |
| --- | --- | --- | --- |
| 开发 | Instabox 开发机（见 `docs/backend-contract.md` §2） | 任意分支 | 开发机本地 MariaDB（docker compose） |
| 测试/演示 | `https://money.acosx.top`（VM3） | **只部署 git tag** | VM3 MariaDB 中独立库 `ecommerce_money_copilot` |

开发中的关卡、认证改动只存在于分支和开发机；演示站点只会运行某个已打 tag、已通过测试的版本，并可一条命令回滚（#48）。

## 2. 拓扑

```text
浏览器 ──HTTPS──> 阿里云 ESA（DNS + 边缘，TLS 在此终止，证书 *.acosx.top）
        ──HTTP──> VM1 SafeLine WAF（站点 id 17，server_names '*'）
        ──HTTP──> VM2 HAProxy :18090（按 Host 路由，money.acosx.top -> b_wp_vm3）
        ──HTTP──> VM3 Apache :80 name-based vhost money.acosx.top
                    ├─ 静态文件：/srv/ecommerce-money-copilot/current/{index.html,assets/,css/,js/}
                    └─ /api/ /auth/ /admin/ ──> 127.0.0.1:8790 FastAPI（uvicorn，用户 emc）
                                                   └─> MariaDB 127.0.0.1:3306（Galera 节点）
```

- ESA 记录：`money.acosx.top` A/AAAA → SafeLine，开启代理，与 `storyoutside.acosx.top` 设置相同。
- HAProxy：`/etc/haproxy/conf.d/p2-direct.cfg` 的已登记 Host 列表与 `use_backend b_wp_vm3` 各增加一行。未登记的 Host 一律 403。
- Apache：`/etc/httpd/conf.d/money-acosx.conf`，由 `deploy/apache/money-acosx.conf.template` 渲染。
  - 静态目录默认拒绝，只放行 `/`、`/index.html`、`/assets/`、`/css/`、`/js/` 和代理路径；点文件、`backend/`、`deploy/`、`docs/` 返回 403。
  - 统一设置 `X-Forwarded-Proto: https`（内部各跳均为 HTTP）。`X-Forwarded-For` 由各跳追加，uvicorn 只信任 127.0.0.1 传来的转发头。
  - 安全头：`X-Content-Type-Options`、`Referrer-Policy`、HSTS、`frame-ancestors 'self'` 的 CSP。当前前端含内联脚本，所以 CSP 允许 `'unsafe-inline'`；脚本迁移到 `js/` 后应收紧。
  - 请求体：`/api/evidence` 上限 11 MiB，其他代理路径上限 1 MiB，超限直接返回 413（后端仍按约定做精确校验）。
  - 静态资源启用 gzip，API 响应不压缩。

## 3. 目录与服务

| 路径 | 说明 |
| --- | --- |
| `/srv/ecommerce-money-copilot/releases/<tag>/` | 每个 tag 一个只读发布目录（`git archive` 导出，无 `.git`） |
| `/srv/ecommerce-money-copilot/current` | 指向当前发布的符号链接（原子切换） |
| `/srv/ecommerce-money-copilot/previous` | 上一个发布，`rollback.sh` 默认回到这里 |
| `/srv/ecommerce-money-copilot/repo.git` | 仓库镜像，部署时 fetch tag |
| `/srv/ecommerce-money-copilot/deploy-history.log` | 部署/回滚记录 |
| `/var/lib/ecommerce-money-copilot/uploads/` | 证据附件私有目录（0700 emc，不经 Apache 暴露） |
| `/var/backups/ecommerce-money-copilot/` | 本应用的备份与恢复演练日志（0700 root） |
| `/usr/local/libexec/ecommerce-money-copilot/` | 已安装的运维脚本；`/usr/local/sbin/emc-*` 为快捷入口 |

systemd 单元（`deploy/systemd/`）：

| 单元 | 作用 |
| --- | --- |
| `ecommerce-money-copilot-api.service` | uvicorn `emc_api.main:app`，`127.0.0.1:8790`，User=emc，加固选项（ProtectSystem=strict 等），只可写上传目录。首次部署带后端的 tag 时由 `deploy.sh` 启用 |
| `ecommerce-money-copilot-backup.timer` | 每日 02:40 备份 |
| `ecommerce-money-copilot-health.timer` | 每 5 分钟探测公网健康 |

SELinux（enforcing）：发布目录为 `httpd_sys_content_t`，`releases/*/backend`、uv 管理的 Python 与运维脚本为 `bin_t`，上传目录为 `var_lib_t`（Apache 不可读）。`install-host.sh` 负责登记这些规则，`deploy.sh` 在构建后执行 `restorecon`。

主机侧组件安装或更新（幂等，不会启动 API）：

```bash
sudo deploy/scripts/install-host.sh --enable-timers
```

## 4. 发布与回滚

只部署 tag，流程如下：

1. 在 main 上合并已通过测试的 PR；
2. 打 tag，例如 `git tag v0.1.0 && git push origin v0.1.0`；
3. 在 VM3 上执行：

```bash
sudo emc-deploy v0.1.0
```

`deploy.sh` 依次执行：

1. fetch tag，导出到 `releases/<tag>`（同名目录已存在且 commit 不同则拒绝覆盖）；
2. 在 `backend/` 中运行 `uv sync --frozen --no-dev`；
3. 先做一次部署前备份，再以 `emc` 用户、迁移账号执行 `alembic upgrade head`；
4. 原子切换 `current`，重启 API，检查 `http://127.0.0.1:8790/api/health`（不含后端的发布则检查静态首页）；
5. 健康检查失败时自动切回上一个发布并重启，记录到 `deploy-history.log`。

默认保留最近 5 个发布，加上 current 和 previous。

手动回滚：

```bash
sudo emc-rollback            # 回到 previous
sudo emc-rollback v0.1.0     # 回到指定发布
```

注意：回滚只切换代码，**不回退数据库迁移**。迁移应保持向后兼容（先加列/表，下一版本再删）。必须回退结构时，用部署前备份（`emc-*-predeploy-<tag>.sql.gz`）恢复。

## 5. 数据库（VM3 MariaDB 复用评估，#7）

- 库：`ecommerce_money_copilot`（utf8mb4 / utf8mb4_unicode_ci；服务器默认是 latin1，因此库和连接串都显式指定 utf8mb4）。
- 账号（只授权本库，仅 `localhost` 与 `127.0.0.1`）：
  - `emc_app`：SELECT / INSERT / UPDATE / DELETE，最多 60 个连接；
  - `emc_migrate`：本库 ALL，仅供 Alembic 使用，最多 5 个连接。
  - 已验证 `emc_app` 不能执行 DDL，也看不到、访问不到其他库。
- 容量：现有全部库合计约 45 MB；根分区约 40 GiB 可用；`max_connections` 5000，历史峰值 22。证据附件存文件系统，不进数据库。
- Galera（2 节点集群，本机为其中一个节点）：
  - 只用 InnoDB，每张表必须有主键；
  - `auto_increment_increment=2`，自增 ID 不连续属正常；
  - 提交时可能因认证冲突返回死锁错误（1213），写接口应可重试，配合幂等键使用；
  - DDL 以 TOI 方式在全集群同步执行，迁移要小，避免长时间锁表；
  - 避免超大事务（gcache 128 MB）；
  - 备份使用 `--single-transaction`，不加全局读锁，以免阻塞整个集群。
- 故障隔离：本应用与其他站点共用同一个 `mariadbd` 进程，独立库和连接上限能限制影响范围，但无法隔离慢查询或资源争用。两节点集群没有仲裁节点，网络分区时两边都可能停止写入，所有使用该集群的站点都会受影响。这属于集群现有风险，本项目不做改动；如需改进，可增加 garbd 仲裁节点。

## 6. 备份与恢复演练

两层备份：

1. 主机级（已有）：每日 03:30 的 `vm3-data-backup` 对整个 MariaDB 执行 `mariadb-dump --all-databases --single-transaction`，加密后上传异地，本地只保留最新一份。本库新建后即自动包含在内。
2. 应用级（本仓库）：`backup-db.sh` 每日 02:40 运行：
   - 对本库执行 `mariadb-dump --single-transaction --routines --events --triggers`，gzip 后校验完整性；
   - 同时打包上传目录，生成 sha256；
   - 文件权限 0600，保留 14 天；
   - 部署前也会自动执行一次。

恢复演练：

```bash
sudo emc-restore-drill                 # 使用最新备份
sudo emc-restore-drill <dump.sql.gz>   # 指定备份
```

演练会把备份恢复到临时库 `emc_restore_drill`，逐表比对 `COUNT(*)`，检查上传归档可读，然后删除临时库。结果追加到 `/var/backups/ecommerce-money-copilot/restore-drill.log`。退出码含义：0 一致，2 行数不一致，1 出错。请在低流量时段运行，因为备份之后写入的数据会被计为不一致。

从备份恢复到正式库（会覆盖数据，先停服务）：

```bash
sudo systemctl stop ecommerce-money-copilot-api
sudo emc-backup-db --label before-restore
zcat /var/backups/ecommerce-money-copilot/<dump>.sql.gz | sudo mariadb ecommerce_money_copilot
sudo tar -C /var/lib/ecommerce-money-copilot -xzf /var/backups/ecommerce-money-copilot/<dump>.uploads.tar.gz
sudo systemctl start ecommerce-money-copilot-api
```

## 7. 监控

`ecommerce-money-copilot-health.timer` 每 5 分钟探测一次：

- API 服务启用后探测 `https://money.acosx.top/api/health`，要求 2xx；
- 启用前探测静态首页，非 5xx 即视为正常。

告警沿用主机现有站点巡检的规则：连续 3 次失败写 ALERT，连续 3 次成功写 RECOVER。格式为 `时间|站点|ALERT/RECOVER|次数|详情`，追加到 `/var/lib/acosx-monitor/pending-alerts.log`，由现有中继统一转发。状态文件：`/var/lib/ecommerce-money-copilot-monitor/state`。

查看：

```bash
systemctl list-timers 'ecommerce-money-copilot-*'
journalctl -u ecommerce-money-copilot-health -n 20
journalctl -u ecommerce-money-copilot-api -f
tail -f /var/log/httpd/money-acosx-access.log
```

## 8. 凭据位置（只列路径）

| 文件 | 内容 | 权限 |
| --- | --- | --- |
| `/etc/ecommerce-money-copilot/app.env` | `EMC_ENV`、`EMC_PUBLIC_ORIGIN`、`EMC_COOKIE_SECURE`、`EMC_UPLOAD_DIR`、`EMC_SESSION_SECRET`、`EMC_REVIEWER_SUBS` | 0600 root |
| `/etc/ecommerce-money-copilot/oauth.env` | `EMC_OIDC_*`（Acos Connect client `ecommerce-money-copilot`） | 0600 root |
| `/etc/ecommerce-money-copilot/db.env` | `EMC_DATABASE_URL`（emc_app）、`EMC_MIGRATE_DATABASE_URL`（emc_migrate） | 0600 root |

systemd 以 root 身份读取 EnvironmentFile 后再切换到 `emc`，因此这些文件不需要对 `emc` 可读。API 进程中会移除 `EMC_MIGRATE_DATABASE_URL`，迁移账号只在 `deploy.sh` 中使用。

添加审核员：编辑 `app.env` 中的 `EMC_REVIEWER_SUBS`（以逗号分隔的 Acos Connect `sub`），然后执行 `systemctl restart ecommerce-money-copilot-api`。
