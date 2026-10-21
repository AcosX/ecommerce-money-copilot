"""`/auth/login`、`/auth/callback`、`/auth/logout`（契约 §5）挂载点。

OIDC 登录模块在此路由上实现上述接口；会话创建与吊销使用
`emc_api.security.create_session` / `set_session_cookie` / `revoke_session` /
`clear_session_cookie`，`/auth/logout` 需显式依赖 `emc_api.security.require_csrf`。
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/auth", tags=["auth"])
