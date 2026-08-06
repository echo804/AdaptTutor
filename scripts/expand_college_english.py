# -*- coding: utf-8 -*-
"""扩充 college_english：词汇 34→200+（四级/考研分难度）、翻译 10→25、图谱加节点。

- 四级核心词 80 → p403（difficulty 0.5）
- 考研进阶词 90 → p404（difficulty 0.65）
- 翻译题新增 15 道（汉译英 简单/中等/困难 + 英译汉）→ p601/p602
- 图谱：p403→p404（四级→考研）、p401→p403（词根→四级词汇）
幂等：已有 qid 跳过。
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
random.seed(7)

# ---- 四级核心词（英→中，p403） ----
CET4 = [
    "ability 能力", "accept 接受", "achieve 实现", "advance 前进；推进", "advantage 优势",
    "affect 影响", "afford 负担得起", "allow 允许", "appear 出现", "approach 方法；接近",
    "argue 争论", "attach 附上", "avoid 避免", "behavior 行为", "benefit 利益；受益",
    "calculate 计算", "cause 原因；导致", "challenge 挑战", "communicate 交流", "compare 比较",
    "compete 竞争", "complete 完成", "concern 关心；涉及", "condition 条件；状况", "consider 考虑",
    "contain 包含", "continue 继续", "create 创造", "culture 文化", "decide 决定",
    "decrease 减少", "demand 需求；要求", "describe 描述", "develop 发展", "difference 差异",
    "direction 方向", "discover 发现", "discuss 讨论", "distance 距离", "divide 划分",
    "education 教育", "effect 效果", "effort 努力", "encourage 鼓励", "energy 能量",
    "environment 环境", "especially 尤其", "example 例子", "exist 存在", "expect 期望",
    "experience 经验；经历", "explain 解释", "express 表达", "fact 事实", "fail 失败",
    "familiar 熟悉的", "famous 著名的", "figure 数字；人物", "finally 最后", "focus 焦点；专注",
    "follow 跟随", "force 力量；强迫", "foreign 外国的", "forget 忘记", "form 形式；形成",
    "forward 向前", "free 自由的；免费的", "future 未来", "general 一般的", "grow 成长",
    "happen 发生", "health 健康", "history 历史", "human 人类", "imagine 想象",
    "important 重要的", "improve 改进", "include 包括", "increase 增加", "industry 工业",
]

# ---- 考研进阶词（英→中，p404） ----
KAOYAN = [
    "abandon 放弃", "abundant 丰富的", "accelerate 加速", "accommodate 容纳；适应", "accumulate 积累",
    "accurate 准确的", "acknowledge 承认", "acquire 获得", "adapt 适应", "adequate 充足的",
    "adjust 调整", "advocate 提倡", "allocate 分配", "alternative 替代的", "ambiguous 模糊的",
    "anticipate 预期", "apparent 明显的", "appeal 吸引力；上诉", "arbitrary 任意的", "assert 断言",
    "assume 假设", "attribute 归因于", "authority 权威", "available 可获得的", "barrier 障碍",
    "boost 提升", "budget 预算", "candidate 候选人", "capacity 容量；能力", "category 类别",
    "cease 停止", "circumstance 环境；情况", "cite 引用", "clarify 澄清", "coherent 连贯的",
    "collapse 崩溃", "commit 承诺；犯（错）", "commodity 商品", "compensate 补偿", "comprehensive 全面的",
    "conceal 隐藏", "concentrate 集中", "concept 概念", "conclude 得出结论", "concrete 具体的",
    "conduct 实施", "confine 限制", "confirm 确认", "conflict 冲突", "conform 遵守",
    "confront 面对", "consensus 共识", "consequence 后果", "conserve 保护；节约", "considerable 相当大的",
    "consistent 一致的", "constitute 构成", "constrain 约束", "construct 构建", "consult 咨询",
    "consume 消耗", "contaminate 污染", "contemplate 深思", "contemporary 当代的", "contend 主张",
    "contract 合同；收缩", "contradict 反驳", "contribute 贡献", "conventional 传统的", "convert 转换",
    "convey 传达", "cooperate 合作", "coordinate 协调", "correlate 相关", "correspond 对应",
    "credible 可信的", "cultivate 培养", "currency 货币", "curriculum 课程", "cycle 循环",
    "decisive 决定性的", "decline 下降；拒绝", "dedicate 奉献", "deduce 推断", "deficiency 缺乏",
    "define 定义", "deliberate 故意的", "demonstrate 证明；演示", "denote 表示", "dense 密集的",
    "derive 源自", "designate 指定", "despise 鄙视", "deteriorate 恶化", "determine 决定；测定",
]

# ---- 新增翻译题：(题干, 参考译文, 难度, 节点) ----
TRANSLATE = [
    ("汉译英：'我们学校有很多学生。'", "There are many students in our school.", 0.4, "p601"),
    ("汉译英：'他每天早晨六点起床。'", "He gets up at six every morning.", 0.45, "p601"),
    ("汉译英：'这本书是我朋友送的。'", "My friend gave me this book.", 0.5, "p601"),
    ("汉译英：'她喜欢在晚上散步。'", "She likes taking a walk in the evening.", 0.5, "p601"),
    ("汉译英：'那个正在画画的孩子是我的弟弟。'", "The child who is drawing is my younger brother.", 0.6, "p602"),
    ("汉译英：'尽管天气不好，我们还是去了公园。'", "Although the weather was bad, we still went to the park.", 0.6, "p602"),
    ("汉译英：'这座桥是去年建成的。'", "The bridge was built last year.", 0.6, "p602"),
    ("汉译英：'他问了我一个很难回答的问题。'", "He asked me a question that was hard to answer.", 0.6, "p602"),
    ("汉译英：'人们普遍认为，阅读能开阔视野。'", "It is widely believed that reading broadens one's horizons.", 0.65, "p602"),
    ("汉译英：'随着互联网的普及，信息传播的速度大大加快。'", "With the popularity of the Internet, the speed of information dissemination has greatly accelerated.", 0.7, "p602"),
    ("汉译英：'无论遇到什么困难，我们都应该坚持下去。'", "No matter what difficulties we encounter, we should persevere.", 0.7, "p602"),
    ("汉译英：'保护环境，人人有责。'", "Protecting the environment is everyone's responsibility.", 0.7, "p602"),
    ("英译汉：'Practice makes perfect.'", "熟能生巧。", 0.5, "p601"),
    ("英译汉：'Where there is a will, there is a way.'", "有志者事竟成。", 0.55, "p601"),
    ("英译汉：'The more you read, the more you learn.'", "你读得越多，学到的就越多。", 0.55, "p602"),
]


def _split_words(entries: list[str]) -> list[tuple[str, str]]:
    return [(line.split()[0], " ".join(line.split()[1:])) for line in entries]


def letters(n: int) -> list[str]:
    return [chr(65 + i) for i in range(n)]


def build_choice(content: str, correct: str, distractors: list[str], node: str, qid: str, diff: float) -> dict:
    pool = [c for c in distractors if c != correct]
    opts = random.sample(pool, 3) + [correct]
    random.shuffle(opts)
    ans = letters(4)[opts.index(correct)]
    return {
        "id": qid,
        "type": "choice",
        "content": content,
        "difficulty": diff,
        "options": [f"{l}. {o}" for l, o in zip(letters(4), opts)],
        "answer": ans,
        "tags": ["core-vocabulary"],
        "step_node_map": {"step1": node},
    }


def main() -> None:
    qs = json.loads((PACK / "questions.json").read_text(encoding="utf-8"))
    existing = {q["id"] for q in qs}
    added: list[dict] = []
    meanings_all = [m for _, m in _split_words(CET4 + KAOYAN)]
    n = 35  # vq001-034 已存在，从 vq035 继续

    def next_qid() -> str:
        nonlocal n
        while f"vq{n:03d}" in existing:
            n += 1
        qid = f"vq{n:03d}"
        n += 1
        return qid

    # 四级词 → p403（difficulty 0.5）
    for word, meaning in _split_words(CET4):
        if f"vq{n:03d}" in existing:
            n += 1
            continue
        added.append(build_choice(
            f"单词 '{word}' 的意思是什么？", meaning, meanings_all, "p403", next_qid(), 0.5,
        ))

    # 考研词 → p404（difficulty 0.65）
    for word, meaning in _split_words(KAOYAN):
        if f"vq{n:03d}" in existing:
            n += 1
            continue
        added.append(build_choice(
            f"单词 '{word}' 的意思是什么？", meaning, meanings_all, "p404", next_qid(), 0.65,
        ))

    # 翻译题
    for i, (content, answer, diff, node) in enumerate(TRANSLATE):
        qid = f"tq{i + 11:03d}"  # tq001-010 已存在，从 tq011 开始
        if qid in existing:
            continue
        added.append({
            "id": qid,
            "type": "open",
            "content": content,
            "difficulty": diff,
            "options": [],
            "answer": answer,
            "tags": ["translation"],
            "step_node_map": {"step1": node},
        })

    qs.extend(added)
    (PACK / "questions.json").write_text(
        json.dumps(qs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )

    # 图谱：加 p403/p404 + 边
    g = json.loads((PACK / "knowledge_graph.json").read_text(encoding="utf-8"))
    node_ids = {x["id"] for x in g["nodes"]}
    if "p403" not in node_ids:
        g["nodes"].append({"id": "p403", "name": "四级核心词汇", "difficulty": 0.5, "importance": 0.8})
    if "p404" not in node_ids:
        g["nodes"].append({"id": "p404", "name": "考研进阶词汇", "difficulty": 0.65, "importance": 0.75})
    edge_keys = {(e["from"], e["to"]) for e in g["edges"]}
    for f, t in [("p401", "p403"), ("p403", "p404")]:
        if (f, t) not in edge_keys:
            g["edges"].append({"from": f, "to": t, "type": "prerequisite"})
    (PACK / "knowledge_graph.json").write_text(
        json.dumps(g, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )

    print(f"新增 {len(added)} 道（词汇 {len([a for a in added if a['type']=='choice'])} + 翻译 {len([a for a in added if a['type']=='open'])}），共 {len(qs)} 题")
    print(f"图谱节点 {len(g['nodes'])} / 边 {len(g['edges'])}")

    asyncio.run(_update_stats(len(qs), len(g["nodes"])))
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
