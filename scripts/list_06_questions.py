# -*- coding: utf-8 -*-
"""列出 llm_app_dev 0.6 难度全部题，供难度校准挑选。"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

q = json.load(open("domain_packs/llm_app_dev/questions.json", encoding="utf-8"))
n = 0
for x in q:
    if x["difficulty"] == 0.6:
        n += 1
        node = next(iter((x.get("step_node_map") or {}).values()), "?")
        print(f"[{x['id']}] {x['type']:6s} node={node:5s} | {x['content'][:72]}")
print("0.6 档共", n, "道")
