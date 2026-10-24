# Acos Connect — 电商搞钱参谋 (`ecommerce-pixel`) 专属登录皮肤

本目录归档了统一认证服务 **Acos Connect** 中为「电商搞钱参谋（`ecommerce-money-copilot`）」定制的像素风认证界面皮肤及回归测试。

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

## 2026-10-24：浮岛登录页新版前端

本目录现已按主项目风格重做页面：天空背景、独立透明浮岛插画、奶油纸张表单及黄色操作按钮。登录、注册、授权确认、找回密码、重发验证、重置密码和消息页使用相同外壳；表单 action、字段、服务端主题判定及 Cookie 校验保持原契约。

### 素材与部署

- `assets/login-island.webp`：独立生成的透明前景，1000×1000，约 257 KiB。
- `assets/login-sky.webp`：独立生成的天空背景，1536×1024，约 50 KiB。
- 部署时将 `theme_branding.py` 与同级 `assets/` 一起复制到 Acos Connect 服务目录。页面由服务端嵌入这两个固定素材的 Data URL，不需要新增公开素材路由；宿主 CSP 的 `img-src` 如有限制，需要允许 `data:`。
- `ecommerce-pixel.css` 与 Python 内嵌 `_CSS` 保持一致，测试会检查两者同步。
- 返回小岛地址默认为 `https://money.acosx.top/`，可通过 `ACOS_CONNECT_GAME_URL` 指定。
- 本次仅修改此仓库中的主题前端，没有发布或修改线上 Acos Connect，也没有配置本地 OIDC 客户端。

### 本地预览与检查

在仓库根目录使用现有后端虚拟环境执行：

```powershell
backend\.venv\Scripts\python.exe acos-connect-theme/tools/preview.py --port 5194
backend\.venv\Scripts\python.exe -m pytest acos-connect-theme/tests/test_login_render.py -q
```

预览入口：`http://127.0.0.1:5194/login`，另有 `/register`、`/forgot-password`、`/resend-verification`、`/reset-password`、`/preview/error`、`/preview/consent`、`/preview/message`。预览仅监听本机且拒绝 POST，不提供真实认证。

浏览器布局回归：`node acos-connect-theme/tests/login-layout.cjs`。需安装 Playwright 与 Edge，可用 `EMC_PLAYWRIGHT_MODULE` 指定 Playwright 模块；`EMC_LOGIN_PREVIEW_URL` 指定预览地址，`EMC_LOGIN_SHOTS` 指定截图目录。覆盖 1440×900、1280×720、768×1024、390×844、320×568 的八类页面。

旧 `tests/test_theme_branding.py` 是宿主认证服务的完整 OAuth + PKCE 回归，依赖 Acos Connect 的 `app.py`；此仓库只归档了主题模块，无法在这里宣称该集成测试已通过。发布到宿主前仍应在隔离认证环境运行它。

移动端（≤740px）不显示前景浮岛，仅保留品牌栏、返回入口和表单。桌面插画使用 contain 保持原比例。
