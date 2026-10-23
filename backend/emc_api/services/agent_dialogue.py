"""Small, deterministic helpers for dialogue context and honest offline assistance."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any


def dialogue_kind(message: str) -> str:
    text = message.strip().lower().rstrip("！!。？?~～ ")
    if text in {"你好", "您好", "嗨", "hi", "hello", "在吗", "你是谁", "小商", "早上好"}:
        return "greeting"
    if text in {"谢谢", "谢谢你", "好的", "好", "明白了", "收到", "辛苦了", "太好了"}:
        return "acknowledgement"
    if any(
        word in text for word in ("答非所问", "没回答", "无关", "没听懂", "不是这个意思", "机械")
    ):
        return "repair"
    if any(word in text for word in ("焦虑", "好累", "想放弃", "没信心", "压力好大")):
        return "support"
    return "task"


def normalize_history(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    # Never accept client system/developer/tool roles, even on guest requests.
    return [
        {"role": item["role"], "content": str(item.get("text") or item.get("content") or "")[:2000]}
        for item in items[-12:]
        if item.get("role") in ("user", "assistant")
        and isinstance(item.get("text") or item.get("content"), str)
        and str(item.get("text") or item.get("content")).strip()
    ]


def calculate_unit_roi(message: str) -> dict[str, Any] | None:
    """Read labelled amounts only; budgets, level numbers and days are not prices."""
    amount = r"\s*(?:是|为|价|约|大概|每单|改为|改成|：|:)?\s*[¥￥]?\s*(-?\d+(?:\.\d+)?)"

    def read(labels: str) -> Decimal | None:
        matches = re.findall(rf"(?:{labels}){amount}", message, flags=re.IGNORECASE)
        return Decimal(matches[-1]) if matches else None

    price = read(r"售价|零售价|卖价|定价|卖|售")
    cost = read(r"拿货成本|拿货价|进货价|供货价|采购成本|拿货|进货|(?<!包邮)(?<!运费)成本")
    total_given = read(r"综合成本|总成本|全部成本")
    if total_given is not None:
        cost = total_given
    if (
        price is None
        or cost is None
        or not (0 < price <= 1_000_000_000)
        or not (0 <= cost <= 1_000_000_000)
    ):
        return None
    shipping = read(r"快递包材|快递费|运费|快递|物流费|包邮成本")
    packaging = read(r"包装费|包材费|包材|包装")
    commission = read(r"佣金|扣点|平台费率")
    # A bare fee is not a percentage. Keep rate and currency accounting separate.
    fee = Decimal(0)
    if commission is not None:
        rate = re.search(r"(?:佣金|扣点|平台费率)" + amount + r"\s*[%％]", message)
        fee = price * commission / 100 if rate else commission
    extras = [v for v in (shipping, packaging, commission) if v is not None]
    if any(v < 0 or v > 1_000_000_000 for v in extras):
        return None
    total = cost if total_given is not None else cost + (shipping or 0) + (packaging or 0) + fee
    profit = price - total
    margin = profit / price
    missing = [
        name
        for name, v in (("运费", shipping), ("包材", packaging), ("平台费用", commission))
        if v is None
    ]
    missing += ["广告费", "退货损耗", "税费"]
    if total_given is not None:
        missing = ["需核对综合成本是否含广告费、退货损耗、税费"]
    return {
        "selling_price": float(price),
        "total_cost": float(total),
        "unit_profit": float(round(profit, 2)),
        "gross_margin_pct": float(round(margin * 100, 2)),
        "breakeven_roi": float(round(1 / margin, 2)) if margin > 0 else None,
        "retail_price_yuan": float(price),
        "supply_price_yuan": float(cost),
        "margin_rate_pct": float(round(margin * 100, 2)),
        "missing_costs": missing,
        "verdict": ("按提供的综合成本估算，" + missing[0])
        if total_given is not None
        else ("按已提供成本估算，尚未计入" + "、".join(missing)),
    }


def offline_reply(
    message: str,
    *,
    kind: str,
    conversation: list[dict[str, str]],
    citations: list[dict[str, Any]],
    level_guide: dict[str, Any],
) -> str:
    if kind == "greeting":
        return (
            "我在，我是小商，陪你把开店的想法一步步做出来。"
            "选方向、比较商品、写文案或看数据都可以。你现在最想解决哪件事？"
        )
    if kind == "acknowledgement":
        return "好，需要时随时叫我。也可以把刚才那一步的结果发来，我们接着看。"
    if kind == "repair":
        previous = [m["content"] for m in conversation if m["role"] == "user"]
        subject = f"你上一条问的是「{previous[-1][:90]}」。" if previous else ""
        return (
            subject + "刚才的回复没有对上你的问题。目前智能对话暂不可用；我会保留上下文。"
            "可以稍后重试，或先告诉我你希望拿到结论、具体步骤还是一份文案。"
        )
    if kind == "support":
        return (
            "先缓一缓，不用一次解决所有事。是预算压力、一直没订单，还是不知道下一步做什么？"
            "挑最困扰的一件说，我们先把它拆成今天能做的小事。"
        )
    if any(w in message for w in ("没流量", "没订单", "卖不出去", "没人买")):
        return (
            "先看看顾客卡在哪一步：曝光少，看流量来源；有人看到却不点，看封面和标题；"
            "有人点进却不买，再查价格、详情和评价。把同一时间段的曝光、点击、订单数发给我，"
            "先定位最值得改的一环。"
        )
    if any(w in message for w in ("下一步", "怎么开始", "从哪里开始", "拆成", "先做什么")):
        return (
            f"先做一件事：{level_guide['checklist'][0]}。"
            "把你已有的材料或卡住的地方发给我，我帮你继续拆成可操作的步骤。"
        )
    if (
        citations
        and any(
            w in message
            for w in (
                "怎么",
                "如何",
                "什么",
                "哪些",
                "区别",
                "多少",
                "限制",
                "步骤",
                "教程",
                "规则",
                "挂载",
            )
        )
        and not any(w in message for w in ("帮我写", "写一", "文案", "计划", "哪一步"))
    ):
        hit = citations[0]
        points = [str(p).strip() for p in hit.get("key_points", []) if str(p).strip()]
        guidance = "；".join(points[:2]) if points else str(hit.get("summary") or "")[:220]
        return (
            "智能对话暂不可用，先给你相关资料中的操作要点："
            + guidance
            + f"。参考《{hit['title']}》。你已经做到哪一步，具体卡在哪里？"
        )
    return (
        "目前智能对话暂不可用，也没有检索到足够相关的资料，我还不能可靠地回答这个问题。"
        "这条消息和前文会保留供本次对话继续使用，可以稍后重试。"
    )
