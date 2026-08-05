"""诊断引擎：KST 简化选题 + BKT 参数化更新 + 终止条件。

对齐 docs/03-项目架构.md 2.1 与 04 1.5：
- BKT 文献默认 P(L0)=0.3 / P(T)=0.05 / P(G)=0.2 / P(S)=0.1（参数化，来自领域包）
- 诊断终止 = 根因置信度 ≥ 阈值 或 15 题上限（对齐 02 硬指标）
"""

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
) -> Question | None:
    """KST 简化选题：薄弱节点（掌握度最低）+ 难度匹配。

    mastery: {node_id: 掌握概率}，未记录视为 0（未学）。
    返回候选集中 priority 最高者（薄弱度优先、难度贴近 0.6）。
    """
    if not questions:
        return None

    def priority(q: Question) -> float:
        node_mastery = [mastery.get(n, 0.0) for n in q.step_node_map.values()]
        weakness = 1 - (min(node_mastery) if node_mastery else 0.5)
        diff_penalty = abs(q.difficulty - 0.6)
        return weakness * 10 - diff_penalty

    return max(questions, key=priority)


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
