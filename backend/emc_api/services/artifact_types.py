"""正式成果类型、关卡映射与版本化结构校验（契约 §7，#26）。

- V1 映射：
  - L1 -> business_plan（经营方案）
  - L2 -> product_selection（选品单）
  - L3 -> asset_pack（素材包）
  - L4 -> listing_record（上架记录）
  - L5 -> content_post（内容发布）
  - L6 -> data_review（复盘报告）
- 通用限制：`content` 必须是非空 JSON 对象，序列化后 <= 128 KiB，嵌套深度 <= 8；
  若包含 `extensions` 字段且非 None，必须为 JSON 对象（dict）。
- V1 对 `(business_plan, 1)` 与 `(product_selection, 1)` 内置结构校验；
  其余类型可在关卡字段确定后通过 `register_artifact_schema(artifact_type, schema_version, model)`
  注册新版本模型，不影响旧版本读取。
"""

from __future__ import annotations

from typing import Any, Final

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictFloat,
    StrictInt,
    ValidationError,
    field_validator,
    model_validator,
)

from ..errors import ValidationFailed
from ..hashing import canonical_json

LEVEL_TO_ARTIFACT_TYPE: Final[dict[str, str]] = {
    "L1": "business_plan",
    "L2": "product_selection",
    "L3": "asset_pack",
    "L4": "listing_record",
    "L5": "content_post",
    "L6": "data_review",
}

ARTIFACT_TYPE_TO_LEVEL: Final[dict[str, str]] = {v: k for k, v in LEVEL_TO_ARTIFACT_TYPE.items()}

ALLOWED_LEVEL_IDS: Final[frozenset[str]] = frozenset(LEVEL_TO_ARTIFACT_TYPE.keys())
ALLOWED_ARTIFACT_TYPES: Final[frozenset[str]] = frozenset(LEVEL_TO_ARTIFACT_TYPE.values())

MAX_CONTENT_BYTES: Final[int] = 128 * 1024
MAX_CONTENT_DEPTH: Final[int] = 8


def origin_label(origin: str) -> str:
    """成果来源的 UI 展示文案（契约 §8）。"""
    return "来自教学模拟" if origin == "tutorial_copy" else "正式经营"


def level_id_for_type(artifact_type: str) -> str | None:
    return ARTIFACT_TYPE_TO_LEVEL.get(artifact_type)


def _strip_non_empty(value: str | None, field_name: str, max_len: int = 4000) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{field_name} 不能为空字符串")
    if len(stripped) > max_len:
        raise ValueError(f"{field_name} 长度不能超过 {max_len} 字符")
    return stripped


class BusinessPlanContentV1(BaseModel):
    """L1 经营方案 V1 结构校验模型。允许关卡扩展额外字段。"""

    model_config = ConfigDict(extra="allow")

    positioning: str | None = None
    summary: str | None = None
    platform: str | None = None
    target_platform: str | None = None
    category: str | None = None
    target_audience: str | None = None
    budget: StrictInt | StrictFloat | None = Field(default=None, ge=0)
    target_revenue: StrictInt | StrictFloat | None = Field(default=None, ge=0)
    goals: list[Any] | None = None
    extensions: dict[str, Any] | None = None

    @field_validator(
        "positioning",
        "summary",
        "platform",
        "target_platform",
        "category",
        "target_audience",
    )
    @classmethod
    def _validate_text_fields(cls, value: str | None, info: Any) -> str | None:
        return _strip_non_empty(value, str(info.field_name))


class ProductSelectionItemV1(BaseModel):
    """选品单项：至少包含 name / title / sku 之一，且价格/成本若提供须 >= 0。"""

    model_config = ConfigDict(extra="allow")

    name: str | None = None
    title: str | None = None
    sku: str | None = None
    price: StrictInt | StrictFloat | None = Field(default=None, ge=0)
    cost: StrictInt | StrictFloat | None = Field(default=None, ge=0)

    @field_validator("name", "title", "sku")
    @classmethod
    def _validate_item_text(cls, value: str | None, info: Any) -> str | None:
        return _strip_non_empty(value, str(info.field_name), max_len=500)

    @model_validator(mode="after")
    def _require_identifier(self) -> ProductSelectionItemV1:
        extra = self.model_extra or {}
        has_extra_name = isinstance(extra.get("product_name"), str) and bool(
            extra["product_name"].strip()
        )
        if not (self.name or self.title or self.sku or has_extra_name):
            raise ValueError("选品项必须包含非空的 name、title 或 sku")
        return self


class ProductSelectionContentV1(BaseModel):
    """L2 选品单 V1 结构校验模型。允许关卡扩展额外字段。"""

    model_config = ConfigDict(extra="allow")

    items: list[ProductSelectionItemV1] | None = Field(default=None, min_length=1)
    products: list[ProductSelectionItemV1] | None = Field(default=None, min_length=1)
    category: str | None = None
    platform: str | None = None
    rationale: str | None = None
    summary: str | None = None
    extensions: dict[str, Any] | None = None

    @field_validator("category", "platform", "rationale", "summary")
    @classmethod
    def _validate_text_fields(cls, value: str | None, info: Any) -> str | None:
        return _strip_non_empty(value, str(info.field_name))


_SCHEMA_REGISTRY: dict[tuple[str, int], type[BaseModel]] = {}


def register_artifact_schema(
    artifact_type: str, schema_version: int, model: type[BaseModel]
) -> None:
    """注册 `(artifact_type, schema_version)` 的 Pydantic 校验模型。"""
    if artifact_type not in ALLOWED_ARTIFACT_TYPES:
        raise ValueError(f"unknown artifact_type: {artifact_type!r}")
    if (
        isinstance(schema_version, bool)
        or not isinstance(schema_version, int)
        or schema_version < 1
    ):
        raise ValueError("schema_version must be an integer >= 1")
    if not isinstance(model, type) or not issubclass(model, BaseModel):
        raise TypeError("model must be a Pydantic BaseModel subclass")
    _SCHEMA_REGISTRY[(artifact_type, schema_version)] = model


def get_artifact_schema(artifact_type: str, schema_version: int) -> type[BaseModel] | None:
    return _SCHEMA_REGISTRY.get((artifact_type, schema_version))


register_artifact_schema("business_plan", 1, BusinessPlanContentV1)
register_artifact_schema("product_selection", 1, ProductSelectionContentV1)


def _exceeds_max_depth(value: Any, max_depth: int = MAX_CONTENT_DEPTH) -> bool:
    """检查 dict/list 嵌套深度是否超过 `max_depth`（根对象深度为 1）。"""
    stack: list[tuple[Any, int]] = [(value, 1)]
    while stack:
        current, depth = stack.pop()
        if depth > max_depth:
            return True
        if isinstance(current, dict):
            for child in current.values():
                if isinstance(child, dict | list):
                    stack.append((child, depth + 1))
        elif isinstance(current, list):
            for child in current:
                if isinstance(child, dict | list):
                    stack.append((child, depth + 1))
    return False


def validate_artifact_content(
    artifact_type: str, schema_version: int, content: Any
) -> dict[str, Any]:
    """校验成果内容并返回规范化后的 dict；失败抛出 422 `ValidationFailed`。"""
    if artifact_type not in ALLOWED_ARTIFACT_TYPES:
        raise ValidationFailed.field(
            ["body", "artifact_type"], f"不支持的成果类型: {artifact_type}"
        )
    if (
        isinstance(schema_version, bool)
        or not isinstance(schema_version, int)
        or schema_version < 1
    ):
        raise ValidationFailed.field(["body", "schema_version"], "schema_version 必须为正整数")
    if not isinstance(content, dict):
        raise ValidationFailed.field(["body", "content"], "content 必须为 JSON 对象")
    if _exceeds_max_depth(content, MAX_CONTENT_DEPTH):
        raise ValidationFailed.field(
            ["body", "content"], f"content 嵌套层级不能超过 {MAX_CONTENT_DEPTH} 层"
        )
    try:
        serialized = canonical_json(content)
    except (TypeError, ValueError):
        raise ValidationFailed.field(["body", "content"], "content 必须为合法 JSON 对象") from None
    if len(serialized.encode("utf-8")) > MAX_CONTENT_BYTES:
        raise ValidationFailed.field(["body", "content"], "content 大小不能超过 128 KiB")

    if "extensions" in content and content["extensions"] is not None:
        if not isinstance(content["extensions"], dict):
            raise ValidationFailed.field(
                ["body", "content", "extensions"], "extensions 必须为 JSON 对象"
            )

    non_ext_keys = [k for k in content if k != "extensions"]
    if not non_ext_keys:
        raise ValidationFailed.field(["body", "content"], "content 不能为空对象")

    model_cls = _SCHEMA_REGISTRY.get((artifact_type, schema_version))
    if model_cls is not None:
        try:
            instance = model_cls.model_validate(content)
        except ValidationError as exc:
            errors = [
                {
                    "loc": [
                        "body",
                        "content",
                        *[p if isinstance(p, int | str) else str(p) for p in err.get("loc", ())],
                    ],
                    "msg": str(err.get("msg", "")),
                    "type": str(err.get("type", "value_error")),
                }
                for err in exc.errors()
            ]
            raise ValidationFailed(details={"errors": errors}) from None
        return instance.model_dump(exclude_unset=True)

    return dict(content)


__all__ = [
    "ALLOWED_ARTIFACT_TYPES",
    "ALLOWED_LEVEL_IDS",
    "ARTIFACT_TYPE_TO_LEVEL",
    "BusinessPlanContentV1",
    "LEVEL_TO_ARTIFACT_TYPE",
    "MAX_CONTENT_BYTES",
    "MAX_CONTENT_DEPTH",
    "ProductSelectionContentV1",
    "ProductSelectionItemV1",
    "get_artifact_schema",
    "level_id_for_type",
    "origin_label",
    "register_artifact_schema",
    "validate_artifact_content",
]
