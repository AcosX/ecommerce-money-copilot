"""证据附件私有存储、文件头（magic bytes）识别、文件名消毒与 multipart 解析（#31）。

契约 §2 / §6 / §9：
- 单文件 ≤ `EMC_MAX_UPLOAD_BYTES`（默认 10 MiB）；
- 仅允许 PNG / JPEG / WebP / PDF，按文件头魔数识别，绝不信任客户端扩展名或 Content-Type；
- 私有目录 `EMC_UPLOAD_DIR` 存储，随机 storage_key，原子落盘，路径越界检查。
"""

from __future__ import annotations

import os
import re
import secrets
from datetime import datetime
from email.message import EmailMessage
from email.parser import BytesParser
from email.policy import HTTP
from pathlib import Path

from fastapi import Request

from ..config import Settings
from ..errors import NotFound, PayloadTooLarge, UnsupportedMediaType, ValidationFailed
from ..ids import EVIDENCE, has_prefix
from ..timeutil import utcnow

MULTIPART_OVERHEAD_BYTES = 64 * 1024

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"
PDF_MAGIC = b"%PDF-"
RIFF_MAGIC = b"RIFF"
WEBP_MAGIC = b"WEBP"

_UNSAFE_FILENAME_CHARS = re.compile(r'[\x00-\x1f\x7f/\\"\';`<>|:*?]+')
MAX_FILENAME_LENGTH = 200


def detect_file_type(data: bytes) -> tuple[str, str]:
    """按文件头魔数检测真实媒体类型，返回 `(content_type, ext)`。

    不匹配允许的 4 种格式（或为空字节）时抛出 415 `UnsupportedMediaType`。
    """
    if data.startswith(PNG_MAGIC):
        return "image/png", ".png"
    if data.startswith(JPEG_MAGIC):
        return "image/jpeg", ".jpg"
    if len(data) >= 12 and data[:4] == RIFF_MAGIC and data[8:12] == WEBP_MAGIC:
        return "image/webp", ".webp"
    if data.startswith(PDF_MAGIC):
        return "application/pdf", ".pdf"
    raise UnsupportedMediaType()


def sanitize_filename(filename: str | None, ext: str) -> str:
    """消毒客户端上传的原始文件名：去除路径组件与控制字符，截断至 200 字符。"""
    raw = (filename or "").replace("\\", "/").split("/")[-1]
    raw = os.path.basename(raw)
    cleaned = _UNSAFE_FILENAME_CHARS.sub("_", raw).strip().lstrip(".")
    if not cleaned:
        cleaned = f"evidence{ext}"
    if len(cleaned) > MAX_FILENAME_LENGTH:
        cleaned = cleaned[:MAX_FILENAME_LENGTH]
    return cleaned


def _parse_content_type_boundary(content_type: str) -> str | None:
    if not content_type or "\r" in content_type or "\n" in content_type:
        return None
    msg = EmailMessage()
    msg["Content-Type"] = content_type
    if msg.get_content_type() != "multipart/form-data":
        return None
    boundary = msg.get_param("boundary")
    if not isinstance(boundary, str):
        return None
    boundary = boundary.strip()
    if not boundary or len(boundary) > 200:
        return None
    return boundary


async def parse_multipart_file(request: Request, max_bytes: int) -> tuple[str, bytes]:
    """使用标准库解析 `multipart/form-data` 中的单个 `file` 文件字段。"""
    content_type = request.headers.get("content-type", "")
    boundary = _parse_content_type_boundary(content_type)
    if boundary is None:
        raise ValidationFailed.field(["body", "file"], "请使用 multipart/form-data 上传文件")

    raw = await request.body()
    if len(raw) > max_bytes + MULTIPART_OVERHEAD_BYTES:
        raise PayloadTooLarge()
    if not raw:
        raise ValidationFailed.field(["body", "file"], "请使用 multipart/form-data 上传文件")

    try:
        closing = f"--{boundary}--".encode("latin-1")
        header_prefix = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode(
            "latin-1"
        )
    except UnicodeEncodeError:
        raise ValidationFailed.field(
            ["body", "file"], "请使用 multipart/form-data 上传文件"
        ) from None

    if closing not in raw:
        raise ValidationFailed.field(["body", "file"], "multipart 请求体不完整")

    msg = BytesParser(policy=HTTP).parsebytes(header_prefix + raw)
    if not msg.is_multipart():
        raise ValidationFailed.field(["body", "file"], "请使用 multipart/form-data 上传文件")

    file_parts: list[tuple[str, bytes]] = []
    for part in msg.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue
        field_name = part.get_param("name", header="content-disposition")
        if field_name != "file":
            continue
        filename = part.get_filename()
        if filename is None:
            raise ValidationFailed.field(["body", "file"], "必须提供单个 file 文件字段")
        payload = part.get_payload(decode=True)
        file_parts.append((filename, payload if isinstance(payload, bytes) else b""))

    if len(file_parts) != 1:
        raise ValidationFailed.field(["body", "file"], "必须提供单个 file 文件字段")

    filename, file_bytes = file_parts[0]
    if len(file_bytes) == 0:
        raise ValidationFailed.field(["body", "file"], "上传文件不能为空")
    if len(file_bytes) > max_bytes:
        raise PayloadTooLarge()
    return filename, file_bytes


def _resolve_contained_path(base_dir: Path, storage_key: str) -> Path:
    if (
        not storage_key
        or storage_key.startswith(("/", "\\"))
        or "\\" in storage_key
        or "\x00" in storage_key
    ):
        raise NotFound()
    rel = Path(storage_key)
    if rel.is_absolute() or ".." in rel.parts:
        raise NotFound()
    candidate = base_dir / rel
    if candidate.is_symlink():
        raise NotFound()
    target = candidate.resolve()
    if not target.is_relative_to(base_dir) or target == base_dir:
        raise NotFound()
    return target


def write_evidence_file(
    settings: Settings,
    *,
    evidence_id: str,
    data: bytes,
    ext: str,
    now: datetime | None = None,
) -> str:
    """将证据字节原子写入私有存储目录，返回相对 `storage_key`。"""
    if len(data) == 0:
        raise ValidationFailed.field(["body", "file"], "上传文件不能为空")
    if len(data) > settings.max_upload_bytes:
        raise PayloadTooLarge()
    if not has_prefix(evidence_id, EVIDENCE):
        raise ValueError(f"invalid evidence_id: {evidence_id!r}")
    if ext not in (".png", ".jpg", ".webp", ".pdf"):
        raise UnsupportedMediaType()

    ts = now or utcnow()
    storage_key = f"{ts.strftime('%Y/%m')}/{evidence_id}_{secrets.token_hex(8)}{ext}"
    base_dir = Path(settings.upload_dir).resolve()
    base_dir.mkdir(parents=True, exist_ok=True, mode=0o750)
    target = _resolve_contained_path(base_dir, storage_key)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)

    tmp_path = target.parent / f".tmp_{evidence_id}_{secrets.token_hex(8)}"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return storage_key


def read_evidence_file(settings: Settings, storage_key: str) -> Path:
    """校验 `storage_key` 在私有上传目录内且文件存在，返回绝对路径；否则抛 404 `NotFound`。"""
    base_dir = Path(settings.upload_dir).resolve()
    target = _resolve_contained_path(base_dir, storage_key)
    if not target.is_file():
        raise NotFound()
    return target


def remove_evidence_file(settings: Settings, storage_key: str) -> None:
    """尽力删除已落盘文件（仅用于事务回滚/重试时的清理）。"""
    try:
        base_dir = Path(settings.upload_dir).resolve()
        target = _resolve_contained_path(base_dir, storage_key)
        target.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass
