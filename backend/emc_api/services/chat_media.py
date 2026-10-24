"""Bounded inline images; never remote URLs or arbitrary file paths."""

import base64
import io
import warnings

from PIL import Image


def validate_image(value: str) -> str:
    try:
        header, encoded = value.split(",", 1)
        if (
            header
            not in {"data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64"}
            or len(encoded) > 273068
        ):
            raise ValueError()
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > 200 * 1024:
            raise ValueError()
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError()
                if image.width * image.height > 4096 * 4096:
                    raise ValueError()
                if header.split(";")[0] != "data:" + Image.MIME[image.format]:
                    raise ValueError()
                image.verify()
    except Exception as exc:
        raise ValueError("请发送有效的 PNG、JPG 或 WebP 图片，每张压缩后不超过 200 KB") from exc
    return value
