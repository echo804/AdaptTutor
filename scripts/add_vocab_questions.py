# -*- coding: utf-8 -*-
"""为 college_english 包补充"记单词"题（程序化生成，确定性）：
- 英→中 词义选择 choice ×20（词根词缀词）
- 中→英 反查选择 choice ×9（动词短语）
- 拼写填空 blank ×5（构词规则）
追加到 questions.json，保留原有题目。
"""
import asyncio
import json
import random
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select

from app.domain.loader import load_pack
from app.persistence.db import get_session_factory
from app.persistence.models import UserDomain

PACK = Path(__file__).resolve().parent.parent / "domain_packs" / "college_english"
random.seed(42)

# 英→中：词根词缀词（词义是唯一正确的中文释义）
EN2CN = [
    ("inspect", "检查", "p401"), ("respect", "尊重", "p401"), ("prospect", "前景", "p401"),
    ("export", "出口", "p401"), ("import", "进口", "p401"), ("transport", "运输", "p401"),
    ("rewrite", "重写", "p402"), ("return", "返回", "p402"), ("preview", "预习", "p402"),
    ("precaution", "预防", "p402"), ("irregular", "不规则的", "p402"), ("impossible", "不可能的", "p402"),
    ("unhappy", "不开心的", "p402"), ("decision", "决定", "p402"), ("development", "发展", "p402"),
    ("happiness", "幸福", "p402"), ("useful", "有用的", "p402"), ("useless", "无用的", "p402"),
    ("readable", "可读的", "p402"), ("modernize", "现代化", "p402"),
]

# 中→英：动词短语反查
CN2EN = [
    ("起飞", "take off", "p202"), ("接管", "take over", "p202"), ("开始从事", "take up", "p202"),
    ("推迟", "put off", "p202"), ("忍受", "put up with", "p202"), ("提出（建议）", "put forward", "p202"),
    ("克服", "get over", "p202"), ("与……相处", "get along with", "p202"), ("摆脱", "get rid of", "p202"),
]

# 拼写填空：构词规则
SPELL = [
    ("根据词根构词规则，'重写'的英文是 ______。", "rewrite", "p402"),
    ("'不规则的'的英文是 ______（ir- 表否定 + regular）。", "irregular", "p402"),
    ("'发展'的名词形式是 ______（develop + -ment）。", "development", "p402"),
    ("'幸福'的名词形式是 ______（happy 变 y 为 i + -ness）。", "happiness", "p402"),
    ("'简化'的动词是 ______（simple 变 i + -ify）。", "simplify", "p402"),
]

ALL_MEANINGS = [m for _, m, _ in EN2CN]


def letters(n: int) -> list[str]:
    return [chr(65 + i) for i in range(n)]


def build_choice(content: str, correct: str, distractors: list[str], node: str, qid: str) -> dict:
    pool = [c for c in distractors if c != correct]
    opts = random.sample(pool, 3) + [correct]
    random.shuffle(opts)
    ans = letters(4)[opts.index(correct)]
    return {
        "id": qid,
        "type": "choice",
        "content": content,
        "difficulty": 0.55,
        "options": [f"{l}. {o}" for l, o in zip(letters(4), opts)],
        "answer": ans,
        "tags": ["core-vocabulary"],
        "step_node_map": {"step1": node},
    }


def main() -> None:
    qs = json.loads((PACK / "questions.json").read_text(encoding="utf-8"))
    existing = {q["id"] for q in qs}
    added: list[dict] = []
    n = 1

    # 英→中 词义选择
    for word, meaning, node in EN2CN:
        if f"vq{n:03d}" in existing:
            n += 1
            continue
        added.append(build_choice(
            f"单词 '{word}' 的意思是什么？", meaning, ALL_MEANINGS, node, f"vq{n:03d}",
        ))
        n += 1

    # 中→英 反查（distractor 用其他短语）
    phrasal_pool = [p for _, p, _ in CN2EN]
    for cn, en, node in CN2EN:
        if f"vq{n:03d}" in existing:
            n += 1
            continue
        added.append(build_choice(
            f"中文'{cn}'对应的英语动词短语是？", en, phrasal_pool, node, f"vq{n:03d}",
        ))
        n += 1

    # 拼写填空
    for content, word, node in SPELL:
        if f"vq{n:03d}" in existing:
            n += 1
            continue
        added.append({
            "id": f"vq{n:03d}",
            "type": "blank",
            "content": content,
            "difficulty": 0.6,
            "options": [],
            "answer": word,
            "tags": ["core-vocabulary"],
            "step_node_map": {"step1": node},
        })
        n += 1

    if not added:
        print("无新增（已全部存在）")
        return

    qs.extend(added)
    (PACK / "questions.json").write_text(
        json.dumps(qs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(f"新增 {len(added)} 道词汇题（共 {len(qs)} 道）")

    asyncio.run(_update_count(len(qs)))
    p = load_pack("college_english")
    print(f"load_pack 校验通过：{len(p.questions)} 题")


async def _update_count(total: int) -> None:
    factory = get_session_factory()
    async with factory() as db:
        d = (await db.execute(select(UserDomain).where(UserDomain.pack_id == "college_english"))).scalar_one()
        d.questions_count = total
        await db.commit()


if __name__ == "__main__":
    main()
