"""错题溯源精细化测试（M3 F3：溯源一致率 ≥ 70%）。

场景模拟：用领域包真实图谱（30 节点），随机选薄弱点，构造
"已探测"证据集，trace_root_evidenced 输出应命中薄弱链（表面错题或其薄弱祖先）。
"""

import random

from app.domain.loader import load_pack
from app.engine.graph_engine import KnowledgeGraph, trace_root_evidenced

_WEAK_P = 0.10   # 薄弱节点掌握度
_NORMAL_P = 0.90  # 正常节点掌握度
_ANC_P = 0.25    # 薄弱祖先（根因更靠前）掌握度


def _graph() -> KnowledgeGraph:
    pack = load_pack("junior_math_eq_ineq")
    return KnowledgeGraph(pack.graph)


def _candidate_wrong_nodes(g: KnowledgeGraph) -> list[str]:
    """优先选有前置依赖的节点（溯源链有意义）。"""
    return [n for n in g.node_ids if g.prereq[n]]


def test_trace_uses_only_evidenced_nodes():
    """无已探测祖先时保守返回错题节点本身（不瞎猜未测节点）。"""
    g = _graph()
    w = _candidate_wrong_nodes(g)[0]
    mastery = {n: _NORMAL_P for n in g.node_ids}
    mastery[w] = _WEAK_P
    # 祖先均未探测
    root = trace_root_evidenced(g, w, mastery, answered={w})
    assert root == w


def test_trace_finds_root_in_weak_ancestor():
    """已探测的薄弱祖先掌握度更低 → 根因判定为祖先（非表面错题）。"""
    g = _graph()
    w = _candidate_wrong_nodes(g)[0]
    anc = sorted(g.ancestors(w))[0]
    mastery = {n: _NORMAL_P for n in g.node_ids}
    mastery[w] = 0.4      # 表面错题
    mastery[anc] = _ANC_P  # 根因更靠前
    root = trace_root_evidenced(g, w, mastery, answered={w, anc})
    assert root == anc


def test_trace_ignores_unprobed_low_mastery():
    """未探测的掌握度最低祖先不被误判为根因（M2 缺陷回归）。"""
    g = _graph()
    w = _candidate_wrong_nodes(g)[0]
    ancestors = sorted(g.ancestors(w))
    if not ancestors:
        return  # 无前置则跳过
    unprobed = ancestors[0]  # 未探测
    mastery = {n: _NORMAL_P for n in g.node_ids}
    mastery[w] = _WEAK_P
    mastery[unprobed] = 0.0  # 未测但假设极低——不应作为证据
    root = trace_root_evidenced(g, w, mastery, answered={w})
    assert root == w  # 只探测了 w


def test_consistency_rate_over_70():
    """模拟 30 场景，溯源一致率 ≥ 70%（F3 验收项）。"""
    g = _graph()
    rng = random.Random(2026)
    candidates = _candidate_wrong_nodes(g)
    hits = 0
    total = 30

    for _ in range(total):
        w = rng.choice(candidates)
        ancestors = list(g.ancestors(w))
        mastery = {n: _NORMAL_P for n in g.node_ids}
        # 薄弱链：w 及其 1-2 个前置祖先（根因可能在前）
        weak_chain = {w}
        mastery[w] = _WEAK_P
        for anc in rng.sample(ancestors, min(len(ancestors), rng.randint(1, 2))):
            mastery[anc] = _ANC_P
            weak_chain.add(anc)
        # 探测证据 = 薄弱链 + 若干随机节点
        answered = set(weak_chain) | {
            n for n in rng.sample(list(g.node_ids), 5) if n not in weak_chain
        }

        root = trace_root_evidenced(g, w, mastery, answered=answered)
        if root in weak_chain:
            hits += 1

    rate = hits / total
    assert rate >= 0.7, f"溯源一致率 {rate:.0%} < 70%（{hits}/{total}）"
