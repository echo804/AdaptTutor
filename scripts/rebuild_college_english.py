# -*- coding: utf-8 -*-
"""重构 college_english：题目只保留「记单词 + 翻译」，图谱精简为词根/短语/翻译节点。

- 保留：vq* 词汇题（34）+ p2q001/p2q004（动词短语词义选择）
- 删除：策略理解题（语法/写作/讲解类 open）
- 新增：tq* 翻译题（汉译英 8 + 英译汉 2，open，LLM 语义等价判题）
- 图谱：p401/p402（词根/前缀）→ p201/p202（动词短语）→ p601/p602（汉译英）
"""
import asyncio
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select

from app.domain.loader import load_pack
from app.persistence.db import get_session_factory
from app.persistence.models import UserDomain

PACK = Path(__file__).resolve().parent.parent / "domain_packs" / "college_english"

# 保留的旧题 id（动词短语词义选择 = 记单词）
KEEP = {"p2q001", "p2q004"}

# 翻译题：(题干, 参考译文, 难度, 节点)
TRANSLATE = [
    ("汉译英：'他是一个老师。'", "He is a teacher.", 0.4, "p601"),
    ("汉译英：'我昨天在图书馆里看到了他。'", "I saw him in the library yesterday.", 0.5, "p601"),
    ("汉译英：'随着经济的发展，人们的生活水平有了显著提高。'", "With the development of economy, people's living standards have improved significantly.", 0.65, "p601"),
    ("汉译英：'这是一个古老的城市，它有着悠久的历史。'", "This is an ancient city, which has a long history.", 0.6, "p602"),
    ("汉译英：'一座建在河上的桥连接了两个村庄。'", "A bridge built over the river connects the two villages.", 0.6, "p602"),
    ("汉译英：'如果我有时间，我会帮你。'", "If I had time, I would help you.", 0.55, "p601"),
    ("汉译英：'他成功地完成了任务。'", "He completed the task successfully.", 0.55, "p601"),
    ("汉译英：'手机给我们带来便利的同时，也带来了健康问题。'", "While smartphones bring convenience, they also bring health problems.", 0.7, "p602"),
    ("英译汉：'Actions speak louder than words.'", "行动胜于言语。", 0.5, "p601"),
    ("英译汉：'The book you lent me is interesting.'", "你借给我的那本书很有趣。", 0.55, "p602"),
]

# 精简后的图谱
GRAPH = {
    "nodes": [
        {"id": "p401", "name": "词根决定核心语义", "difficulty": 0.5, "importance": 0.8},
        {"id": "p402", "name": "前缀改变方向或程度", "difficulty": 0.5, "importance": 0.7},
        {"id": "p201", "name": "动词短语的构成与含义", "difficulty": 0.5, "importance": 0.75},
        {"id": "p202", "name": "take 系列动词短语", "difficulty": 0.5, "importance": 0.7},
        {"id": "p601", "name": "汉译英策略：主干提取与修饰挂接", "difficulty": 0.55, "importance": 0.85},
        {"id": "p602", "name": "中文短句与英文从句合并方法", "difficulty": 0.6, "importance": 0.8},
    ],
    "edges": [
        {"from": "p401", "to": "p402", "type": "prerequisite"},
        {"from": "p401", "to": "p201", "type": "prerequisite"},
        {"from": "p201", "to": "p202", "type": "prerequisite"},
        {"from": "p201", "to": "p601", "type": "prerequisite"},
        {"from": "p601", "to": "p602", "type": "prerequisite"},
    ],
}


def main() -> None:
    qs = json.loads((PACK / "questions.json").read_text(encoding="utf-8"))
    kept = [q for q in qs if q["id"] in KEEP]
    vocab = [q for q in qs if q["id"].startswith("vq")]
    trans = [
        {
            "id": f"tq{i:03d}",
            "type": "open",
            "content": content,
            "difficulty": diff,
            "options": [],
            "answer": answer,
            "tags": ["translation"],
            "step_node_map": {"step1": node},
        }
        for i, (content, answer, diff, node) in enumerate(TRANSLATE, start=1)
    ]
    new_qs = kept + vocab + trans
    (PACK / "questions.json").write_text(
        json.dumps(new_qs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    (PACK / "knowledge_graph.json").write_text(
        json.dumps(GRAPH, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(f"重构完成：保留 {len(kept) + len(vocab)} 道（词汇）+ 新增 {len(trans)} 道翻译 = {len(new_qs)} 题")
    print(f"图谱：{len(GRAPH['nodes'])} 节点 / {len(GRAPH['edges'])} 边")

    asyncio.run(_update_stats(len(new_qs), len(GRAPH["nodes"])))
    p = load_pack("college_english")
    dist = {t: sum(1 for q in p.questions if q.type == t) for t in ("choice", "blank", "open", "multi")}
    print(f"load_pack 校验通过：{len(p.questions)} 题，题型分布 {dist}")


async def _update_stats(qn: int, nn: int) -> None:
    factory = get_session_factory()
    async with factory() as db:
        d = (await db.execute(select(UserDomain).where(UserDomain.pack_id == "college_english"))).scalar_one()
        d.questions_count = qn
        d.nodes_count = nn
        await db.commit()


if __name__ == "__main__":
    main()
