"""应用配置：全部来自 `EMC_*` 环境变量（或 backend/.env）。"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
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

    agent_provider: Literal["local", "compatible"] = "local"
    agent_base_url: str = "https://api.openai.com/v1"
    agent_api_key: SecretStr = SecretStr("")
    agent_model: str = ""
    agent_timeout_seconds: float = Field(default=12, gt=0, le=60)
    agent_content_dir: str = ""
    agent_knowledge_dir: str = ""
    agent_emotion_grace_seconds: int = Field(default=1200, ge=60, le=86400)
    agent_emotion_decay_interval_seconds: int = Field(default=300, ge=30, le=3600)
    agent_emotion_decay_points: int = Field(default=5, ge=1, le=20)
    agent_guest_enabled: bool = False
    agent_guest_origins: str = ""
    agent_guest_daily_limit: int = Field(default=20, ge=1, le=1000)
    agent_guest_global_daily_limit: int = Field(default=200, ge=1, le=100000)
    agent_guest_session_hourly_limit: int = Field(default=10, ge=1, le=1000)

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
