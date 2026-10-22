from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class PageContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: str = Field(default="shop", max_length=64)
    selected_item: str | None = Field(default=None, max_length=100)


class ActivityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reset_clock: bool = False


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=2000)
    version: StrictInt = Field(ge=1)
    companion_name: str = Field(default="小商", min_length=1, max_length=12)
    page_context: PageContext = Field(default_factory=PageContext)

    @field_validator("message", "companion_name")
    @classmethod
    def strip_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("不能为空")
        return value.strip()


class EmotionProfile(BaseModel):
    relationship: str
    mood: str
    tone: str
    example: str
    warmth: float
    irritability: float
    level_active_seconds: int = 0
    stagnant_seconds: int = 0
    grace_seconds: int = 1200
    next_decay_seconds: int | None = None
    paused: bool = False
    reason_codes: list[str] = Field(default_factory=list)


class CompanionState(BaseModel):
    affinity: int = 20
    patience: int = 80
    version: int = 1
    level: str = "L1"
    streak: int = 0
    perks: list[str] = Field(default_factory=list)
    source: Literal["server"] = "server"
    emotion: EmotionProfile | None = None


class Source(BaseModel):
    id: str
    title: str
    url: str | None = None


class UIAction(BaseModel):
    type: Literal["show_task", "open_kit", "open_submission"]
    level: str


class Reply(BaseModel):
    text: str
    source: Literal["ai", "local-guide"]
    state: CompanionState
    actions: list[UIAction] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    skill_ids: list[str] = Field(default_factory=list)
    turn_id: str | None = None


class HistoryItem(BaseModel):
    id: str
    sequence: int
    message: str
    reply: Reply
    created_at: str


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    next_before: int | None = None
