"""纯函数关系规则：时间停滞、交流表现和经营进展共同驱动情感。"""

import hashlib
import re
import unicodedata
from datetime import datetime

from .emotion import DEFAULT_POLICY, EmotionPolicy, performance_effects


def evolve(
    affinity: int,
    patience: int,
    memory: dict,
    message: str,
    level: str,
    now: datetime,
    performance: dict | None = None,
    policy: EmotionPolicy = DEFAULT_POLICY,
) -> tuple[int, int, dict]:
    before = (affinity, patience)
    affinity, patience, memory, reasons = performance_effects(
        affinity, patience, memory, level, performance or {}, policy
    )
    normalized = re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", message).lower())
    fingerprint = hashlib.sha256(f"{level}:{normalized}".encode()).hexdigest()
    seen = list(memory.get("seen", []))
    last_at = memory.get("last_at")
    if last_at:
        elapsed = max(0, now.timestamp() - float(last_at))
        active_gap = max(
            0,
            (performance or {}).get("active_seconds", 0)
            - memory.get("active_seconds_at_last_turn", 0),
        )
        rested = max(0, elapsed - active_gap)
        if rested >= 900:
            patience = min(100, patience + min(20, int(rested // 300)))
            reasons.append("rested")
    memory["level"] = level
    # 每日最多五次独立问题获得关系增量，避免无限刷分。
    day = now.date().isoformat()
    count = memory.get("daily_count", 0) if memory.get("day") == day else 0
    clarification = bool(re.search(r"没懂|不明白|不会|举例|再解释|没理解|看不懂", message))
    repeat = memory.get("repeat_count", 0) + 1 if memory.get("last_question") == fingerprint else 1
    delaying = bool(re.search(r"先不做|我懒得|我要摆烂|我不想动|再拖一会", message))
    if delaying and fingerprint not in seen:
        affinity, patience = max(0, affinity - 2), max(0, patience - 5)
        reasons.append("deliberate_delay")
    elif repeat >= 3 and not clarification:
        affinity, patience = max(0, affinity - 1), max(0, patience - 4)
        reasons.append("repeated_without_progress")
    elif normalized and fingerprint not in seen and count < 5:
        goal = bool(re.search(r"(想|目标|希望|计划|打算|需要|准备|怎么|如何|帮我).{2,45}", message))
        evidence = bool(
            re.search(
                r"\d+(?:\.\d+)?\s*(元|块|%|％|次|个|件|单|小时|天|周|万|预算)"
                r"|(预算|货源|数据|成本|点击|曝光|转化|销量|利润|反馈|评价|样本|库存).{0,8}\d"
                r"|(有|没有|已有).{0,6}(货源|店铺|资源|数据|截图)",
                message,
            )
        )
        scope = bool(
            re.search(
                r"小红书|拼多多|本周|上周|近\s*\d+\s*[天周月]|每天|每周|过去|通勤|人群|类目"
                r"|宝妈|学生|上班族|时间范围|家居|服饰|收纳",
                message,
            )
        )
        attempt = bool(
            re.search(
                r"(已经|已尝试|试过|尝试了|对比了|比较了|调整过|改过|验证过|做过|发现|结果是"
                r"|但|不过|仍然|依然).{2,60}",
                message,
            )
        )
        detailed = goal and sum((evidence, scope, attempt)) >= 2
        affinity = min(100, affinity + (4 if detailed else 1))
        patience = min(100, patience + (4 if detailed else 0))
        memory["streak"] = min(3, memory.get("streak", 0) + 1) if detailed else 0
        perks = list(memory.get("perks", []))
        if memory["streak"] == 3 and level not in perks and level != "first_order":
            perks.append(level)
        memory["perks"] = perks
        count += 1
        reasons.append("thoughtful_question" if detailed else "new_question")
    memory.update(
        seen=(seen + [fingerprint])[-120:],
        day=day,
        daily_count=count,
        last_at=now.timestamp(),
        last_question=fingerprint,
        repeat_count=repeat,
        active_seconds_at_last_turn=(performance or {}).get("active_seconds", 0),
        last_change={
            "affinity_delta": affinity - before[0],
            "patience_delta": patience - before[1],
            "reason_codes": reasons,
        },
    )
    return affinity, patience, memory
