# -*- coding: utf-8 -*-
"""llm_app_dev 难度校准：0.6/0.65 档内容偏难的题上调到 hard（0.66-0.75），
解决困难档只有 1 道题的问题。dry-run 打印改动，--apply 写回。"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

F = "domain_packs/llm_app_dev/questions.json"
q = json.load(open(F, encoding="utf-8"))
by_id = {x["id"]: x for x in q}

# (qid, 新难度)
UP = [
    # 0.65 → 0.70（原理/区别分析题）
    ("lq009", 0.7), ("lq016", 0.7), ("rq016", 0.7), ("tq016", 0.7),
    # 0.6 → 0.70（原理分析/综合开放题）
    ("lq003", 0.7), ("lq022", 0.7), ("lq032", 0.7), ("lq052", 0.7),
    ("rq003", 0.7), ("rq033", 0.7), ("rq036", 0.7), ("rq039", 0.7),
    ("aq016", 0.7), ("aq022", 0.7), ("aq029", 0.7), ("aq035", 0.7),
    ("tq006", 0.7), ("tq027", 0.7), ("tq030", 0.7), ("oq004", 0.7),
    ("rq010", 0.66), ("aq019", 0.66), ("aq025", 0.66), ("tq003", 0.66),
    # 0.6 → 0.66（概念辨析/方法选择）
    ("lq005", 0.66), ("lq007", 0.66), ("lq027", 0.66), ("rq009", 0.66),
    ("rq017", 0.66), ("rq029", 0.66), ("rq040", 0.66), ("aq033", 0.66),
    ("tq023", 0.66), ("oq002", 0.66), ("aq004", 0.66), ("aq028", 0.66),
]

missing = [qid for qid, _ in UP if qid not in by_id]
if missing:
    print("!! 不存在的题:", missing)
    sys.exit(1)

print("校准改动（dry-run）：")
for qid, new_diff in UP:
    x = by_id[qid]
    print(f"  {qid}: {x['difficulty']} -> {new_diff} | {x['content'][:44]}")

if "--apply" in sys.argv:
    for qid, new_diff in UP:
        by_id[qid]["difficulty"] = new_diff
    with open(F, "w", encoding="utf-8") as fh:
        json.dump(q, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    hard = [x for x in q if x["difficulty"] >= 0.66]
    print(f"\n已写回。hard 档（≥0.66）题数: {len(hard)}")
else:
    print("\n（未写回；确认后加 --apply 执行）")
