"""服务端情感策略：关系亲疏与当下耐心独立影响语气。"""

from dataclasses import dataclass

from .contracts import EmotionProfile


@dataclass(frozen=True)
class EmotionPolicy:
    grace_seconds: int = 1200
    decay_interval_seconds: int = 300
    decay_points: int = 5


DEFAULT_POLICY = EmotionPolicy()


def performance_effects(
    affinity: int,
    patience: int,
    memory: dict,
    level: str,
    performance: dict,
    policy: EmotionPolicy = DEFAULT_POLICY,
) -> tuple[int, int, dict, list[str]]:
    memory = {**memory}
    reasons = []
    previous_level = memory.get("level", "L1")
    token = performance.get("progress_token")
    if previous_level != level:
        affinity = min(100, affinity + 5)
        patience = max(80, patience)
        memory.update(streak=0, time_units_paid=0, progress_token=token)
        reasons.append("level_completed")
    elif token and memory.get("progress_token") != token:
        previous = memory.get("progress_token")
        seen = list(memory.get("progress_seen", []))
        if previous and token not in seen:
            affinity = min(100, affinity + 2)
            patience = min(100, patience + 8)
            reasons.append("verified_progress")
        memory.update(progress_token=token, time_units_paid=0, progress_seen=(seen + [token])[-60:])
    if previous_level != level or "verified_progress" in reasons:
        memory.update(last_question=None, repeat_count=0)
    memory["level"] = level
    stalled = max(0, int(performance.get("stagnant_seconds", 0)))
    units = max(0, (stalled - policy.grace_seconds) // policy.decay_interval_seconds)
    if performance.get("paused"):
        units = 0
    paid = int(memory.get("time_units_paid", 0))
    delta = max(0, units - paid)
    if delta:
        patience = max(0, patience - delta * policy.decay_points)
        reasons.append("level_stalled")
    memory["time_units_paid"] = units
    return affinity, patience, memory, reasons


def emotion_profile(
    affinity: int,
    patience: int,
    performance: dict | None = None,
    reasons: list[str] | None = None,
    policy: EmotionPolicy = DEFAULT_POLICY,
) -> EmotionProfile:
    performance = performance or {}
    relationship = (
        "亲密搭档"
        if affinity >= 80
        else "熟悉伙伴"
        if affinity >= 50
        else "礼貌同行"
        if affinity >= 25
        else "疏离观察"
    )
    if patience >= 75:
        mood, tone = "耐心", "舒展、耐心，解释清楚，愿意多陪用户拆一步。"
        example = "别急，我们先把最关键的信息理清楚。"
    elif patience >= 55:
        mood, tone = "催促", "语气变干脆，减少寒暄，明确催用户行动。"
        example = "先别把问题越摊越大。把这一项做完，我们再往下走。"
    elif patience >= 35:
        mood, tone = "不耐烦", "明显不耐烦，可以反问和吐槽拖延，但仍给可执行建议。"
        example = "怎么还停在这儿？先交一个具体结果，别一直绕圈。"
    elif patience >= 15:
        mood, tone = "刻薄", "语气尖锐刻薄，讽刺原地打转和光说不做，回答简短直接。"
        example = "这一步都快被你盘出包浆了。先做完眼前这件事，行吗？"
    else:
        mood, tone = "火大", "明显火大、冷硬，允许一句重话批评拖延，随后直接给下一步。"
        example = "别再拿‘再想想’当进度了。现在就做这一件，做完再说。"
    if affinity >= 80:
        tone += "关系很亲近，像恨铁不成钢的熟人，刻薄中仍能看出在意。"
    elif affinity >= 50:
        tone += "承认用户以往的投入，保持伙伴感，但不掩饰不满。"
    elif affinity < 25:
        tone += "保持距离，少用亲昵称呼，不刻意讨好。"
    stalled = max(0, int(performance.get("stagnant_seconds", 0)))
    paused = bool(performance.get("paused"))
    remaining = (
        None
        if paused
        else max(0, policy.grace_seconds - stalled)
        + policy.decay_interval_seconds
        - max(0, stalled - policy.grace_seconds) % policy.decay_interval_seconds
    )
    return EmotionProfile(
        relationship=relationship,
        mood=mood,
        tone=tone,
        example=example,
        warmth=round(affinity / 100, 2),
        irritability=round(1 - patience / 100, 2),
        level_active_seconds=max(0, int(performance.get("active_seconds", 0))),
        stagnant_seconds=stalled,
        grace_seconds=policy.grace_seconds,
        next_decay_seconds=remaining,
        paused=paused,
        reason_codes=reasons or [],
    )


def style_instruction(profile: EmotionProfile) -> str:
    return (
        f"本轮情感表演：关系={profile.relationship}，情绪={profile.mood}。{profile.tone}"
        f"语气示例（按实际问题改写，不能机械重复）：{profile.example}"
        "不必暴露分数、心情参数或假称系统处罚；直接让语言风格体现变化。"
        "刻薄针对拖延、空转等当下行为，不贬低用户人格、智力、身份或人生价值；"
        "不用威胁、歧视或羞辱性脏话。用户不会做时仍解释，不能拒绝答疑或关闭任务。"
    )
