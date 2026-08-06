# -*- coding: utf-8 -*-
"""分析 llm_app_dev 题库难度与 0.6 档题目，为补困难档做准备。"""
import json
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

q = json.load(open("domain_packs/llm_app_dev/questions.json", encoding="utf-8"))
print("难度分布:", dict(sorted(Counter(x["difficulty"] for x in q).items())))
print("题型分布:", dict(Counter(x["type"] for x in q)))
print("总题数:", len(q))
print()
print("== 0.6 难度的题（可评估上调 hard）样本 ==")
n = 0
for x in q:
    if x["difficulty"] == 0.6 and n < 10:
        print(f"[{x['id']}] {x['type']} | {x['content'][:70]} | ans={x['answer']}")
        n += 1
print()
print("== 0.55 / 0.65 难度题 ==")
for x in q:
    if x["difficulty"] in (0.55, 0.65):
        print(f"[{x['id']}] {x['difficulty']} {x['type']} | {x['content'][:60]} | ans={x['answer']}")
