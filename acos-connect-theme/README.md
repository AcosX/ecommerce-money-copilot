# Acos Connect — 电商搞钱参谋 (`ecommerce-pixel`) 专属登录皮肤

本目录归档了统一认证服务 **Acos Connect (`https://auth.acosx.top` / `/opt/acos-connect`)** 中为「电商搞钱参谋（`ecommerce-money-copilot`）」定制的像素风认证界面皮肤及回归测试。

## 文件清单

- `theme_branding.py`：Acos Connect 服务端皮肤模块（含 `BrandingMiddleware`、内联像素风样式 `_CSS` 以及登录、注册、授权确认、消息提示、找回密码、重发验证邮件、重置密码等全部页面渲染函数）。
- `ecommerce-pixel.css`：从 `theme_branding.py` 中提取的独立样式表副本，便于快速查阅与编辑样式。
- `acos-connect-app.patch`：Acos Connect 主程序 `app.py` 接入 `theme_branding.py` 的补丁参考。
- `tests/test_theme_branding.py`：Acos Connect 皮肤与 OIDC 授权码 + PKCE 流程独立回归测试。

## 生效机制

1. 在 Acos Connect 服务端配置环境变量：
   ```dotenv
   ACOS_CONNECT_PIXEL_CLIENT_IDS=ecommerce-money-copilot
   ```
2. 当玩家从电商搞钱参谋发起 `/auth/login` 跳转至 Acos Connect `/authorize` 时，Acos Connect 会签发带 HMAC 签名的 `pending` Cookie（内含 `client_id=ecommerce-money-copilot`）。
3. `BrandingMiddleware` 校验签名并识别 `client_id` 命中 `ACOS_CONNECT_PIXEL_CLIENT_IDS` 后，将当前请求上下文切换为 `ecommerce-pixel` 主题，渲染「电商搞钱参谋」像素风登录/注册/授权/找回密码页面；其他客户端或无签名上下文访问时保持 Acos Connect 默认外观。
