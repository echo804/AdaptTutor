# -*- coding: utf-8 -*-
"""修复 llm_app_dev 多选答案但 type=choice 的题（前端按单选渲染导致无法多选）。"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

F = "domain_packs/llm_app_dev/questions.json"
q = json.load(open(F, encoding="utf-8"))

FIX = {
    "lq035": {"type": "multi"},
    "lq038": {"type": "multi"},
    "lq039": {"type": "multi", "content": "关于 Scaling Law 的描述，以下哪些是正确的？"},
    "lq043": {"type": "multi"},
}

by_id = {x["id"]: x for x in q}
for qid, patch in FIX.items():
    x = by_id[qid]
    old_type = x["type"]
    x.update(patch)
    print(f"{qid}: type {old_type} -> {x['type']} | content={x['content']!r} | answer={x['answer']!r}")

with open(F, "w", encoding="utf-8") as fh:
    json.dump(q, fh, ensure_ascii=False, indent=1)
    fh.write("\n")
print("已写回", F)
