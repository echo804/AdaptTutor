# -*- coding: utf-8 -*-
"""清洗 llm_app_dev 领域包：题干内嵌选项/答案 → 纯题干。
- choice 题：剥离内嵌 A/B/C/D 选项列表（44 题）
- blank 题：__答案__ → ____（lq036/lq040）
- tq004：题干裸写答案 $边界感$ → 问句
写回前 dry-run 打印全部改动；写回后校验。"""
import json
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

F = "domain_packs/llm_app_dev/questions.json"
q = json.load(open(F, encoding="utf-8"))


def strip_inline_options(content: str) -> tuple[str, bool]:
    """找到第一个选项标记（A. B. C. D.）截断，去掉尾部 LaTeX 残留。"""
    marks = list(re.finditer(r"(?<![A-C])[A-D]\s*[.．、]", content))
    if len(marks) < 2:
        return content, False
    head = content[: marks[0].start()]
    # 去掉尾部 LaTeX 残留（\text{ \mathrm{）、$ 与空白
    head = re.sub(r"\\(?:text|mathrm)\{$", "", head)
    head = re.sub(r"[\$\s]+$", "", head)
    head = head.rstrip()
    return head, True


changes: list[tuple[str, str, str]] = []
for x in q:
    c = x.get("content", "")
    if x.get("type") == "choice":
        new, ok = strip_inline_options(c)
        if ok:
            changes.append((x["id"], c, new))
    elif re.search(r"__[^_]{1,24}__", c):
        new = re.sub(r"__[^_]{1,24}__", "____", c)
        changes.append((x["id"], c, new))

for x in q:
    if x["id"] == "tq004":
        changes.append((x["id"], x["content"], "RLHF 的主要作用是帮助模型建立什么？"))

print("待清洗题数:", len(changes))
print()
# 校验：after 非空、无 LaTeX 残留、不含选项标记
issues = 0
for qid, old, new in changes:
    flag = ""
    if not new or re.search(r"\\(?:text|mathrm)\{|\\quad", new) or len(re.findall(r"[A-D][.．、]", new)) >= 1:
        flag = "  <<< 异常"
        issues += 1
    print(f"[{qid}] {old[:40]!r} -> {new!r}{flag}")
print()
print("异常数:", issues)

if issues == 0:
    # 写回（保持原文件 indent=1 格式）
    by_id = {x["id"]: x for x in q}
    for qid, _old, new in changes:
        by_id[qid]["content"] = new
    with open(F, "w", encoding="utf-8") as fh:
        json.dump(q, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print("已写回", F)
else:
    print("存在异常，未写回。")
