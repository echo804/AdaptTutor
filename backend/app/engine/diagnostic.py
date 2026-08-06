"""诊断引擎：KST 简化选题 + BKT 参数化更新 + 终止条件。

对齐 docs/03-项目架构.md 2.1 与 04 1.5：
- BKT 文献默认 P(L0)=0.3 / P(T)=0.05 / P(G)=0.2 / P(S)=0.1（参数化，来自领域包）
- 诊断终止 = 根因置信度 ≥ 阈值 或 15 题上限（对齐 02 硬指标）
"""

import random

from app.domain.schemas import BktParams, DiagnosticRules, Question


def bkt_update(p_learn: float, correct: bool, params: BktParams) -> float:
    """BKT 更新：P(L) → P(L|作答结果)。

    correct=True 用猜测-失误公式，correct=False 用其补集。
    """
    # 先应用学习概率（作答一次可能学会）
    p_after = p_learn + (1 - p_learn) * params.p_t
    if correct:
        num = p_after * (1 - params.p_s)
        den = num + (1 - p_after) * params.p_g
    else:
        num = p_after * params.p_s
        den = num + (1 - p_after) * (1 - params.p_g)
    return num / den if den > 0 else p_after


def select_next_question(
    mastery: dict[str, float],
    questions: list[Question],
    rules: DiagnosticRules,
    recent: dict[str, int] | None = None,
    rng: random.Random | None = None,
) -> Question | None:
    """KST 简化选题：薄弱节点（掌握度最低）+ 难度匹配 + 出题轮换 + 随机多样性。

    mastery: {node_id: 掌握概率}，未记录视为 0（未学）。
    recent: {node_id: 连续作答次数}——M4r20 出题轮换：连续作答节点降权，
    避免"同一薄弱点连出多题"；非薄弱点也轮到，覆盖更广。
    M4r23：加权随机选题——priority 作为权重做轮盘赌，priority 高者更可能被选中，
    但不是必选最高分。同一状态每次可能出不同的题，避免"选一个难度题永远不变"。
    测试可传固定 rng 保证确定性。
    """
    if not questions:
        return None

    def priority(q: Question) -> float:
        node_mastery = [mastery.get(n, 0.0) for n in q.step_node_map.values()]
        weakness = 1 - (min(node_mastery) if node_mastery else 0.5)
        diff_penalty = abs(q.difficulty - 0.6)
        # 出题轮换：该题涉及节点最近连续作答越多，优先级越低（防连出）
        recency = max((recent or {}).get(n, 0) for n in q.step_node_map.values())
        return weakness * 10 - diff_penalty - recency * 2.5

    scored = [(priority(q), q) for q in questions]
    # 权重 = max(0.1, score - min + 1)，保证最低分也有小概率；分数差距大则分化明显
    min_s = min(s for s, _ in scored)
    weights = [max(0.1, s - min_s + 1.0) for s, _ in scored]
    r = rng or random.Random()
    return r.choices([q for _, q in scored], weights=weights, k=1)[0]


def should_terminate(
    mastery: dict[str, float], answered_count: int, rules: DiagnosticRules
) -> bool:
    """终止条件：根因置信度 ≥ 阈值 或 达到题数上限。

    根因置信度简化定义：1 - min(mastery)（掌握度最低节点即根因候选）。
    """
    if answered_count >= rules.termination.max_questions:
        return True
    if not mastery:
        return False
    root_confidence = 1 - min(mastery.values())
    return root_confidence >= rules.termination.confidence_threshold
