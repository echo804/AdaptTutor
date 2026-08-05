"""CLI：诊断 → 薄弱点 → 路径 闭环（M1b 验证，确定性 mock 作答，不依赖真实 LLM）。

用法（backend 目录）：.venv\\Scripts\\python.exe -m app.cli [--pack junior_math_eq_ineq]
"""

import argparse
import random

from app.domain.loader import load_pack
from app.engine.diagnostic import bkt_update, select_next_question
from app.engine.graph_engine import KnowledgeGraph, plan_path, trace_root


def run_diagnosis(pack_id: str, seed: int = 42) -> None:
    pack = load_pack(pack_id)
    graph = KnowledgeGraph(pack.graph)
    rules = pack.diagnostic_rules
    rng = random.Random(seed)

    # 初始掌握度：全部 P(L0)（从同一起点，靠作答暴露薄弱点）
    mastery = {nid: rules.bkt.p_l0 for nid in graph.node_ids}
    true_weak = graph.node_ids[-1]  # 模拟的真实薄弱点（末节点 k8）

    pool = list(pack.questions)
    answered: list[tuple[str, bool]] = []
    answered_counts: dict[str, int] = {}
    count = 0
    while count < rules.termination.max_questions and pool:
        q = select_next_question(mastery, pool, rules)
        pool.remove(q)
        # mock 作答：涉及薄弱点的题大概率答错，其余按掌握度概率答对
        node_mastery = [
            mastery.get(n, rules.bkt.p_l0) for n in q.step_node_map.values()
        ]
        if true_weak in q.step_node_map.values():
            correct = rng.random() > 0.85
        else:
            correct = rng.random() > (1 - min(node_mastery)) * 0.3
        for n in q.step_node_map.values():
            mastery[n] = bkt_update(
                mastery.get(n, rules.bkt.p_l0), correct, rules.bkt
            )
            answered_counts[n] = answered_counts.get(n, 0) + 1
        answered.append((q.id, correct))
        count += 1
        # 终止：薄弱节点（掌握度最低）已被作答 ≥2 次且根因置信度达标
        weak_node = min(mastery, key=mastery.get)
        if (
            answered_counts.get(weak_node, 0) >= 2
            and (1 - mastery[weak_node]) >= rules.termination.confidence_threshold
        ):
            break

    weak_nodes = sorted(mastery, key=mastery.get)[:3]
    path = plan_path(graph, weak_nodes)
    root = trace_root(graph, weak_nodes[0], mastery)

    print(f"领域包: {pack.manifest.id} v{pack.manifest.version}（{pack.manifest.subject}）")
    print(f"作答 {count} 题: " + " ".join(f"{qid}:{'对' if c else '错'}" for qid, c in answered))
    print(f"薄弱点(掌握度最低): {weak_nodes}")
    print(f"推荐学习路径: {path}")
    print(f"根因(溯源): {root}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AdaptTutor 诊断闭环 CLI（M1b 验证）")
    parser.add_argument("--pack", default="junior_math_eq_ineq")
    args = parser.parse_args()
    run_diagnosis(args.pack)
