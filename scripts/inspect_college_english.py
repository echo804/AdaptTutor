# -*- coding: utf-8 -*-
"""查看 college_english 包内容 + 试跑一道 open 题判题。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")

from app.domain.loader import load_pack
from app.engine.evaluator import judge_by_rule

p = load_pack("college_english")
print("== 节点 ==")
for n in p.graph.nodes:
    print(f"  {n.id} [{n.difficulty}] {n.name}")
print("== 边 ==")
for e in p.graph.edges:
    print(f"  {e.from_} -> {e.to}")
print("== open 题 ==")
for q in p.questions:
    if q.type == "open":
        print(f"  [{q.id}] {q.content[:70]}")
        print(f"        答案: {str(q.answer)[:70]}")

print("\n== 判题试跑（规则层，语义等价） ==")
q0 = next(q for q in p.questions if q.type == "open")
print(f"题: {q0.content[:50]}")
print(f"标准答案: {str(q0.answer)[:50]}")
for stu in ["和标准答案一致的表述", "答错的内容"]:
    r = judge_by_rule(stu, q0)
    print(f"  学生答[{stu[:12]}] -> {r}")
