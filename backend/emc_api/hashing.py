"""规范化 JSON 与 SHA-256，用于成果快照哈希、幂等请求指纹等。"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    """稳定序列化：键排序、无多余空白、保留中文、禁止 NaN/Infinity。"""
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def json_sha256(value: Any) -> str:
    return sha256_hex(canonical_json(value))
