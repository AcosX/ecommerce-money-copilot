# 服务器部署与运维模板

本文说明仓库内的通用部署脚本。实际主机拓扑、网络路由、数据库容量、账号授权清单、告警接收方和生产验收记录应保存在私有运维系统。

## 部署前配置

推荐将静态站点和 FastAPI 以同源反向代理部署，数据库与上传目录不对公网提供访问。`deploy/apache/`、`deploy/systemd/` 和 `deploy/scripts/` 提供可调整的模板；路径、端口和站点值都是模板默认值，部署前应按自己的环境检查。

- 从 `backend/.env.example` 创建私有配置，使用自己的数据库、OIDC、数字人和模型服务凭据。
- `app.env`、`oauth.env`、`db.env` 放在 `EMC_ETC` 指定的受限配置目录，文件权限 0600。systemd 读取 EnvironmentFile 后切换为服务用户。
- 运行数据库账号和迁移账号分离；运行进程只持有业务所需权限。迁移账号只用于部署迁移。
- `EMC_REVIEWER_SUBS` 仅由服务端配置；生产使用安全 Cookie 和 HTTPS。
- 设置 `EMC_PUBLIC_HOST`、`EMC_BASE` 等模板变量，并检查 Apache 的 OIDC `form-action`、代理头信任边界、TLS 和 CSP。
- 上传目录必须是私有存储，不能通过静态服务器直接读取。静态目录仅放行页面和发布资源；拒绝点文件、后端、配置和运维目录。
- `health-check.sh` 的告警路径可通过 `EMC_ALERT_LOG` 指定，接收与转发由部署方配置。

安装或更新主机组件前先审阅脚本；安装会写入 systemd、Apache 和 SELinux 配置：

```bash
sudo deploy/scripts/install-host.sh --enable-timers
```

安装脚本不会启动 API 或审核 worker；首次部署相应版本时由部署脚本管理。

## 发布与回滚

开发通过 PR 审查后，部署经过测试的 Git tag：

```bash
sudo emc-deploy <tag>
sudo emc-rollback                 # 回到 previous
sudo emc-rollback <tag>           # 指定版本
```

部署脚本拉取 tag、导出独立发布目录、安装锁定依赖、备份数据库及附件、执行 Alembic 迁移、原子切换 `current` 并进行健康检查。失败时恢复前一版应用。`previous` 用于回滚；部署审计保存在 `EMC_BASE` 下。

回滚只切换应用代码，不回退数据库迁移。迁移应向后兼容；结构回退须先停止写入、另做备份，并在隔离环境验证恢复方案。

## 备份和恢复

```bash
sudo emc-backup-db manual
sudo emc-restore-drill
sudo emc-restore-drill <dump.sql.gz>
```

应用备份包括数据库和上传文件，并生成校验和。配置文件和备份不得进入 Git 或站点静态目录。保留期、备份频率、异地副本和访问控制由部署方制定。

恢复演练会导入临时数据库、比较行数并检查附件归档，然后清理临时库。演练需要相应数据库权限，应在隔离环境或低流量时运行。返回 0 表示一致、2 表示行数不一致、1 表示出错。正式恢复前先停止服务并备份现状，再由数据库管理员执行恢复。

## 监控与审核 worker

健康检查接口为 `/api/health`。定时器和 systemd 日志可用于检查 API、备份与审核 worker；日志、队列内容和截图可能包含用户数据，只保存在私有环境。

包含审核队列的版本需要 `ecommerce-money-copilot-review.service`。更新主机单元后再部署 tag；部署脚本按版本启停 worker，回滚到不含审核模块的版本会停止 worker 并保留队列。

worker 使用运行期 DML 账号和私有上传目录，清除迁移 URL。`EMC_AI_REVIEW_MODEL` 必须支持图片输入和 JSON 输出。调用失败会重试并最终转人工复核；在供应商侧设置额度，并监控 `waiting_manual`、`retry`、最早等待时间和服务重启次数。

在相同的私有运行环境中可执行：

```bash
python -m emc_api.services.review_queue --metrics
python -m emc_api.services.review_queue --once
```

应用回滚保留增量 schema。已有 Agent 审核记录时，迁移降级会拒绝删除审核来源与报告。

## 静态资源与验收

模型展示入口为 `/tools/models.html`，需同步 Apache 模板的精确放行清单，以及页面、模型清单、缩略图和 GLB。安装脚本会先运行 `apachectl configtest`，失败则恢复配置。

发布后检查匿名和登录权限边界、OIDC 往返、证据上传/下载、审核状态、模型展示与缓存；不要将 mock 浏览器检查当作真实外部服务验收。

展示资源详见 [模型展示说明](model-showcase.md)，缓存策略见 [静态缓存说明](static-cache.md)。
