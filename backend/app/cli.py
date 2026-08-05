"""CLI：诊断 → 薄弱点 → 路径 闭环（M1b 验证）与 辅导闭环（M2 F2，mock LLM）。

用法（backend 目录）：
  .venv\\Scripts\\python.exe -m app.cli [--pack junior_math_eq_ineq]        # 诊断闭环
  .venv\\Scripts\\python.exe -m app.cli tutor [--pack junior_math_eq_ineq]  # 辅导闭环
"""

import argparse
import random

from app.domain.loader import load_pack
from app.engine.diagnostic import bkt_update, select_next_question
from app.engine.graph_engine import KnowledgeGraph, plan_path, trace_root
from app.engine.tutor_orchestrator import TutorOrchestrator


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


def run_tutor(pack_id: str) -> None:
    """辅导闭环演示（M2 F2 冻结点，mock LLM，确定性场景）。

    场景：诊断（答错暴露薄弱）→ 路径 → 四态辅导一轮（错→定位→提示→变式→对）→ 小结。
    """
    print("=== M2 辅导闭环演示（mock LLM，不依赖真实 key）===")
    t = TutorOrchestrator(pack_id)

    # 1. 诊断：确定性作答，第 2 题答错暴露薄弱
    answers = [True, False, True]
    for correct in answers:
        st = t.diagnose(correct)
        if st.get("terminated"):
            break
    weak = min(t.mastery, key=t.mastery.get)
    print(f"[诊断] 作答后薄弱点: {weak}（置信度 {1 - t.mastery[weak]:.2f}）")

    # 2. 路径
    path = t.build_path()
    print(f"[路径] 推荐学习路径: {path[:6]}")

    # 3. 四态辅导一轮
    r = t.tutor_start()
    print(f"[辅导] ({r.state}) {r.message}")
    r = t.tutor_step("我算出来是 7。", correct=False)
    print(f"[辅导] ({r.state}) {r.message}")
    r = t.tutor_step("我不确定第一步做什么。", correct=False)
    print(f"[辅导] ({r.state}) {r.message}")
    r = t.tutor_step("我再试试。", correct=True)
    print(f"[辅导] ({r.state}) {r.message}")

    # 4. 小结
    print(f"[小结] {t.summary()}")
    print("=== 辅导闭环可跑通（F2 冻结点达成）===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AdaptTutor 闭环 CLI（M1b 诊断 / M2 辅导）")
    parser.add_argument("command", nargs="?", default="diagnose", choices=["diagnose", "tutor"])
    parser.add_argument("--pack", default="junior_math_eq_ineq")
    args = parser.parse_args()
    if args.command == "tutor":
        run_tutor(args.pack)
    else:
        run_diagnosis(args.pack)
