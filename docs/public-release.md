# 公开发布检查

2026-10-24 审计：当前修复 PR 清理工作树；仓库仍须保持私有，直到下列历史和附件事项完成。清理当前文件不代表历史已脱敏。

## 本次已完成

- 将环境示例中的真实数字人应用 ID 改为留空；模型网关示例和后端默认地址改为公共服务地址，具体模型由部署方配置。
- 运维文档改为通用部署说明，移除生产多跳拓扑、路由配置、集群布局、容量评估、其他站点与生产验收记录。
- 移除开发隧道地址、个人开发目录（包括浏览器测试的个人 Playwright 路径）和知识库构建脚本中的私有工作区标识；构建时显式传入 `--source-dir`。
- 忽略本地 Agent 上下文、云凭据目录、私有配置、备份和生成输出；添加当前跟踪文件与 ZIP 内容的 Gitleaks CI 检查。
- 扫描远程分支、标签和现有 PR head 可达历史、Issue/PR 正文和评论、Release 正文及当前技能 ZIP。已知生产密码、Session/OIDC/AppSecret 和 GitHub Token 未检出；真实数字人应用 ID 曾出现在环境示例中。自动扫描不能证明不存在其他秘密。

## 公开前仍须处理

1. **历史提交**：历史 `backend/resources/agent/knowledge/manifest.json` 包含第三方文件标识，相关原始知识库 ZIP 也在历史中；旧版运维说明、开发地址和真实应用 ID 同样仍可通过历史分支、标签和 PR 访问。需要选择清理全部历史，或建立仅包含审核后快照的独立公开仓库。历史重写会改变提交和 tag 的 SHA，并影响现有部署镜像及协作者检出；须单独安排。旧 PR 引用和缓存可能需 GitHub Support 协助处理。
2. **Issue/PR 页面**：已直接脱敏 #7、#47 的实施评论和 #52 的 PR 正文/标题，保留通用技术与验收记录。仍须检查 GitHub 编辑历史是否保留原文；文件 PR 不会清除页面历史。私密审计记录已另存，不能作为公开附件上传。
3. **Actions**：仓库公开会同时公开已有运行历史和日志。已对 107 次历史运行中的 105 份可下载日志执行密钥和已知凭据扫描，未检出；另 2 次日志无法下载。API 报告有 126 个历史截图 artifacts，尚未逐一人工验收图片，不能标记全部通过。公开前应审阅剩余内容，或备份至私有位置后清理旧运行及其附件。
4. **再分发授权**：确认课程知识库（含结构化摘要与历史原始 ZIP）、下载技能包、生成图片/模型、角色动作和星云 SDK 允许公开再分发。保留已有第三方许可证和作者信息；尚未找到的授权需由资料权利人确认。不要擅自为全部内容添加统一开源许可证。
5. **最终验收**：合并清理 PR 后重新扫描拟公开的全部 refs 和 GitHub 页面/附件，检查 Wiki（审计时未发现可访问的 Wiki 仓库）、Release（当前单个发布无附件）、Actions，启用秘密扫描及推送保护（如可用），再由仓库所有者切换可见性。

CI 的 `Public content checks` 仅防止当前跟踪文件再次带入密钥，刻意不将其结果表述为历史清理完成。应在历史清理后另行执行全历史扫描；不要通过忽略历史文件标识来让审计变绿。

GitHub 官方说明：[切换可见性](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)、[移除敏感历史](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)。
