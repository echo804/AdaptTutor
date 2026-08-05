"""导出领域包审阅清单（Markdown），便于人工校验图谱与题目。

用法（backend 目录）：
  .venv\\Scripts\\python.exe scripts/export_pack_review.py [--pack id] [--out 路径]
默认输出到 stdout；--out 指定文件时写入文件。
"""

import argparse
from pathlib import Path

from app.domain.loader import load_pack
from app.engine.graph_engine import KnowledgeGraph


def build_review(pack_id: str) -> str:
    pack = load_pack(pack_id)
    graph = KnowledgeGraph(pack.graph)
    L: list[str] = []

    L.append(
        f"# 领域包审阅清单：{pack.manifest.subject}（{pack.manifest.id} v{pack.manifest.version}）"
    )
    L.append("")
    L.append("> 由 `scripts/export_pack_review.py` 自动生成，供人工校验。检查点见文末。")
    L.append("")

    # --- 节点 ---
    L.append(f"## 一、知识图谱节点（{len(graph.nodes)} 个）")
    L.append("")
    L.append("| id | 名称 | 难度 | 重要度 | 错误模式 | 前置(from) | 后继(to) |")
    L.append("|---|---|---|---|---|---|---|")
    for nid in graph.node_ids:
        n = graph.nodes[nid]
        pre = "、".join(graph.prereq.get(nid, [])) or "-"
        suc = "、".join(graph.succ.get(nid, [])) or "-"
        em = "、".join(n.error_modes) or "-"
        L.append(
            f"| {nid} | {n.name} | {n.difficulty} | {n.importance} | {em} | {pre} | {suc} |"
        )
    L.append("")

    # --- 题目 ---
    L.append(f"## 二、题目清单（{len(pack.questions)} 题）")
    L.append("")
    L.append("| id | 题型 | 难度 | 标签 | 答案 | 映射节点 | 题干 |")
    L.append("|---|---|---|---|---|---|---|")
    for q in sorted(pack.questions, key=lambda x: x.id):
        nodes = "、".join(sorted(set(q.step_node_map.values())))
        tags = ",".join(q.tags)
        L.append(
            f"| {q.id} | {q.type} | {q.difficulty} | {tags} | {q.answer} | {nodes} | {q.content} |"
        )
    L.append("")

    # --- 检查点 ---
    L.append("## 三、审阅检查点")
    L.append("")
    L.append("1. **节点划分**：知识点是否拆得过细（可合并）或过粗（需拆分）？")
    L.append("2. **前置依赖**：每条 `from → to` 是否真的“先学 from 才能学 to”？方向反了会破坏拓扑与路径。")
    L.append("3. **难度/重要度**：0-1 取值是否符合直觉（基础节点难度低、重要度高）？")
    L.append("4. **错误模式**：每节点列出的常见错误是否覆盖真实学情？")
    L.append("5. **题目**：题干是否清晰、答案是否正确、难度与节点是否匹配？")
    L.append("6. **映射**：每题 step_node_map 指向的节点是否合理（解该题需掌握哪些节点）？")
    L.append("")
    L.append("## 四、结构校验（机器自动，每次生成时附带）")
    L.append("")
    L.append(f"- 节点数：{len(graph.nodes)}（目标 30-50）")
    L.append(f"- 边数：{sum(len(v) for v in graph.succ.values())}")
    L.append(f"- 拓扑排序：{len(graph.topological_order())} 节点，无环")
    covered = {n for q in pack.questions for n in q.step_node_map.values()}
    missing = [n for n in graph.node_ids if n not in covered]
    L.append(f"- 题目覆盖节点：{len(covered)}/{len(graph.node_ids)}（缺失：{missing or '无'}）")
    return "\n".join(L)


def main() -> None:
    parser = argparse.ArgumentParser(description="导出领域包审阅清单")
    parser.add_argument("--pack", default="junior_math_eq_ineq")
    parser.add_argument("--out", default=None, help="输出文件路径（默认 stdout）")
    args = parser.parse_args()
    text = build_review(args.pack)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"已生成: {args.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
