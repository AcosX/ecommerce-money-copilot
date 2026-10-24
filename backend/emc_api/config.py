"""应用配置：全部来自 `EMC_*` 环境变量（或 backend/.env）。"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_origin(value: str, *, allow_path: bool = False) -> str | None:
    """把 URL 规范化为 `scheme://host[:port]`；无法解析或不是 http(s) 时返回 None。

    `allow_path=True` 用于 Referer（带路径）；Origin 与配置值不允许带路径。
    """
    try:
        parts = urlsplit(value.strip())
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        return None
    if parts.username or parts.password:
        return None
    if not allow_path and (parts.path not in ("", "/") or parts.query or parts.fragment):
        return None
    host = parts.hostname.lower()
    if ":" in host:  # IPv6
        host = f"[{host}]"
    default_port = 443 if scheme == "https" else 80
    suffix = f":{port}" if port is not None and port != default_port else ""
    return f"{scheme}://{host}{suffix}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EMC_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["dev", "test", "prod"] = "dev"
    public_origin: str = "http://127.0.0.1:8000"
    database_url: SecretStr = SecretStr("mysql+pymysql://emc@127.0.0.1:3306/emc?charset=utf8mb4")
    session_secret: SecretStr = SecretStr("")

    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: SecretStr = SecretStr("")
    oidc_redirect_uri: str = ""

    # Acos Connect `sub`，逗号分隔
    reviewer_subs: str = ""

    upload_dir: str = "var/uploads"
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    max_files_per_submission: int = Field(default=5, gt=0)
    # 普通请求体上限（证据上传接口除外）
    max_body_bytes: int = Field(default=256 * 1024, gt=0)

    session_idle_seconds: int = Field(default=7 * 24 * 3600, gt=0)
    session_absolute_seconds: int = Field(default=30 * 24 * 3600, gt=0)
    cookie_secure: bool = True

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # 魔珐星云 3D 数字人网关配置（小商具身驱动）
    xingyun_app_id: str = Field(
        default="",
        validation_alias=AliasChoices("EMC_XINGYUN_APP_ID", "XINGYUN_APP_ID"),
    )
    xingyun_app_secret: SecretStr = Field(
        default=SecretStr(""),
        validation_alias=AliasChoices("EMC_XINGYUN_APP_SECRET", "XINGYUN_APP_SECRET"),
    )
    xingyun_gateway_url: str = Field(
        default="https://nebula-agent.xingyun3d.com",
        validation_alias=AliasChoices("EMC_XINGYUN_GATEWAY_URL", "XINGYUN_GATEWAY_URL"),
    )
    xingyun_default_preset: str = Field(
        default="yingyi",
        validation_alias=AliasChoices("EMC_XINGYUN_DEFAULT_PRESET", "XINGYUN_DEFAULT_PRESET"),
    )

    anysearch_api_key: SecretStr = SecretStr("")
    anysearch_base_url: str = "https://api.anysearch.com"
    anysearch_timeout_seconds: float = Field(default=8.0, gt=0, le=15)

    # AI 大模型网关配置（支持 GOOGLE_GEMINI_BASE_URL / GEMINI_API_KEY）
    ai_base_url: str = Field(
        default="https://ai.acosx.xyz",
        validation_alias=AliasChoices("EMC_AI_BASE_URL", "GOOGLE_GEMINI_BASE_URL"),
    )
    ai_api_key: SecretStr = Field(
        default=SecretStr(""),
        validation_alias=AliasChoices("EMC_AI_API_KEY", "GEMINI_API_KEY"),
    )
    ai_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias=AliasChoices("EMC_AI_MODEL", "GEMINI_MODEL"),
    )
    ai_review_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias=AliasChoices("EMC_AI_REVIEW_MODEL", "GEMINI_REVIEW_MODEL"),
    )
    ai_timeout_seconds: float = Field(
        default=20.0,
        gt=0,
        validation_alias=AliasChoices("EMC_AI_TIMEOUT_SECONDS", "GEMINI_TIMEOUT_SECONDS"),
    )

    @field_validator("public_origin")
    @classmethod
    def _check_public_origin(cls, value: str) -> str:
        normalized = normalize_origin(value)
        if normalized is None:
            raise ValueError("EMC_PUBLIC_ORIGIN 必须是 http(s)://host[:port]，不带路径")
        return normalized

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _check_prod(self) -> Settings:
        if self.env == "prod":
            if len(self.session_secret.get_secret_value().encode()) < 32:
                raise ValueError("生产环境 EMC_SESSION_SECRET 至少 32 字节")
            if not self.cookie_secure:
                raise ValueError("生产环境 EMC_COOKIE_SECURE 必须为 true")
            if not self.public_origin.startswith("https://"):
                raise ValueError("生产环境 EMC_PUBLIC_ORIGIN 必须使用 https")
        return self

    @property
    def reviewer_sub_set(self) -> frozenset[str]:
        return frozenset(s.strip() for s in self.reviewer_subs.split(",") if s.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
