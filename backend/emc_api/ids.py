"""带前缀的随机 ID（契约 §6），例如 `ply_k3x9…`。

格式：`<prefix>_` + 26 位小写 base32（128 bit 随机），总长 30，列类型 VARCHAR(32)。
"""

from __future__ import annotations

import base64
import secrets
from typing import Final

PLAYER: Final = "ply"
PROJECT: Final = "prj"
ARTIFACT: Final = "art"
VERIFICATION: Final = "ver"
EVIDENCE: Final = "evd"
REVIEW: Final = "rev"
REQUEST: Final = "req"

PREFIXES: Final = frozenset({PLAYER, PROJECT, ARTIFACT, VERIFICATION, EVIDENCE, REVIEW, REQUEST})

ID_LENGTH: Final = 30


def new_id(prefix: str) -> str:
    if prefix not in PREFIXES:
        raise ValueError(f"unknown id prefix: {prefix!r}")
    raw = base64.b32encode(secrets.token_bytes(16)).decode("ascii").rstrip("=").lower()
    return f"{prefix}_{raw}"


def has_prefix(value: str, prefix: str) -> bool:
    """快速格式检查（不查库）。格式不符的 ID 可直接按 404 处理。"""
    return (
        isinstance(value, str)
        and len(value) == ID_LENGTH
        and value.startswith(f"{prefix}_")
        and all(c in "abcdefghijklmnopqrstuvwxyz234567" for c in value[len(prefix) + 1 :])
    )
