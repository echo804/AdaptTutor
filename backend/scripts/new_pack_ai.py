"""AI 生成领域包（M4r8 需求 1：AI 生成 + 人工校验）。

用法：
  python scripts/new_pack_ai.py --source <素材文档目录> --out <领域包目录>
  python scripts/new_pack_ai.py --dry   # 只校验已有输出，不调用 LLM

流程：
  1. 读素材文档（按主题子目录分组）
  2. 分批调用 LLM（role=generate，系统 key）提炼 图谱节点/边 + 三档题目
  3. 汇总去重 → schema 校验 → load_pack 全量校验
  4. 写出领域包 5 文件 + 审阅清单 md（供人工逐题校验，对齐 04 1.4）
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

# 允许项目根 import（脚本位于 backend/scripts/）
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engine.llm_gateway.gateway import LLMGateway  # noqa: E402
from app.keys.service import decrypt_key  # noqa: E402
from app.persistence.db import get_session_factory  # noqa: E402
from app.persistence.models import UserApiKey  # noqa: E402

TOPIC_PREFIX = {
    "llm": "l",      # 大模型原理
    "rag": "r",      # 检索增强
    "agent": "a",    # 智能体
    "tools": "t",    # 工具链
    "overview": "o",  # 入门概览
}

SYSTEM_PROMPT = """你是领域包内容生成器。根据给定的中文技术文档，提炼「大模型应用开发」领域的学习内容，只输出一个 JSON 对象（不要 markdown 代码块包裹）：

{
  "nodes": [{"id": "l01", "name": "Transformer 架构", "difficulty": 0.5, "importance": 0.8, "error_modes": ["l01_e1"]}],
  "edges": [{"from": "l01", "to": "l02", "type": "prerequisite"}],
  "questions": [
    {"id": "lq001", "type": "choice", "content": "题干（可含 $LaTeX$）", "difficulty": 0.5, "options": ["A. …", "B. …", "C. …", "D. …"], "answer": "B", "error_modes": ["l01_e1"], "tags": ["来源文档名"], "step_node_map": {"step1": "l01"}}
  ]
}

硬性要求：
1. 节点 id 用两位前缀（如 l01/l02…，前缀由我提供），name 是知识点名词短语（8-20 字），difficulty 0.3-0.75，importance 0.4-0.9。
2. 每篇文档提炼 1-2 个节点；节点间只画「前置依赖」边（from 是 to 的前提），只能引用本批生成的节点。
3. 每 2-3 个节点配 2-3 道题：覆盖三题型 choice（4 选项，answer 为正确选项字母）/ blank（答案 ≤ 12 字）/ open（答案 = 关键要点，1-3 句）。
4. 题目必须基于文档真实内容，禁止编造数字/事实；error_modes 填该题最常见的错因（一句话）。
5. tags 填来源文档文件名（如 "llm_prompt_engineering.md"），用于人工审阅溯源。
6. 题目 id 形如 {前缀}q001（前缀由我提供），全局唯一。"""


def read_markdown(path: Path) -> str:
    """读 md：剥离 frontmatter，保留正文（截断防超长）。"""
    raw = path.read_text(encoding="utf-8")
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            raw = parts[2]
    # 去掉图片/链接噪音
    raw = re.sub(r"!\[.*?\]\(.*?\)", "", raw)
    raw = re.sub(r"<[^>]+>", "", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()[:4000]


def extract_json(text: str) -> dict:
    """剥离 markdown 包裹，提取 JSON。"""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("LLM 输出不含 JSON")
    return json.loads(t[start : end + 1])


def parse_batch(gw: LLMGateway, topic: str, prefix: str, docs: list[tuple[str, str]], out: dict, gen_ctx: dict) -> None:
    """调用 LLM 生成一批，并入 out。"""
    # 本批起始序号：按该前缀已生成数量续编（避免跨批 id 冲突被去重丢弃）
    n_existing = sum(1 for k in out["nodes"] if k.startswith(prefix))
    q_existing = sum(1 for k in out["questions"] if k.startswith(prefix + "q"))
    start = n_existing + 1
    qstart = q_existing + 1
    prompt = SYSTEM_PROMPT.replace("（如 l01/l02…，前缀由我提供）", f"（前缀 = {prefix}）")
    prompt = prompt.replace(
        "节点 id 用两位前缀",
        f"节点 id 从 {prefix}{start:02d} 开始连续编号（如 {prefix}{start:02d}、{prefix}{start + 1:02d}…）；题目 id 从 {prefix}q{qstart:03d} 开始连续编号",
    )
    prompt += f"\n\n=== 主题：{topic}（节点前缀 {prefix}，题目前缀 {prefix}q）===\n"
    for name, body in docs:
        prompt += f"\n【文档 {name}】\n{body}\n"
    resp = gw.generate("generate", prompt, ctx={**gen_ctx, "max_tokens": 4000, "temperature": 0.4})
    if resp.mock or resp.level >= 2:
        print(f"[warn] {topic} 批降级（level={resp.level}），输出不可用，跳过")
        return
    try:
        data = extract_json(resp.text)
    except Exception as e:
        print(f"[warn] {topic} 批 JSON 解析失败: {e}\n{resp.text[:300]}")
        return

    for n in data.get("nodes", []):
        nid = n.get("id", "")
        if nid and nid not in out["nodes"]:
            out["nodes"][nid] = n
    for e in data.get("edges", []):
        f, t = e.get("from"), e.get("to")
        if f and t and (f in out["nodes"] and t in out["nodes"]):
            out["edges"].add((f, t))
    for q in data.get("questions", []):
        qid = q.get("id", "")
        if qid and qid not in out["questions"]:
            # 字段规范化（LLM 输出容错）：error_modes 字符串→列表
            em = q.get("error_modes")
            if isinstance(em, str):
                em = [em]
            q["error_modes"] = em or []
            q["options"] = q.get("options") or []
            # 校验 step_node_map 节点存在；不存在则补首个节点
            smap = q.get("step_node_map") or {}
            smap = {k: v for k, v in smap.items() if v in out["nodes"]}
            if not smap and out["nodes"]:
                smap = {"step1": next(iter(out["nodes"]))}
            q["step_node_map"] = smap
            out["questions"][qid] = q
    print(f"[ok] {topic}: +{len(data.get('nodes', []))} 节点 +{len(data.get('questions', []))} 题")


def build_diagnostic_rules() -> dict:
    return {
        "initial_strategy": "weakest_node",
        "termination": {"confidence_threshold": 0.8, "max_questions": 15},
        "bkt": {"p_l0": 0.3, "p_t": 0.05, "p_g": 0.2, "p_s": 0.1},
    }


def build_assessment() -> dict:
    return {"purity_threshold": 0.9, "mastery_threshold": 0.85, "regression_suite": []}


def write_review_manifest(out_dir: Path, nodes: dict, questions: dict) -> None:
    """生成审阅清单（人工逐题校验，对齐 04 1.4：题目 LLM 生成初稿 → 人工逐题校验）。"""
    lines = [
        "# 审阅清单：大模型应用开发领域包（llm_app_dev）",
        "",
        f"- 图谱节点：{len(nodes)} 个　题目：{len(questions)} 道　生成时间：自动",
        "- 人工审阅要求：逐题核对事实正确性/难度/选项唯一性/知识点映射；改后重新运行 `python scripts/new_pack_ai.py --dry` 校验",
        "",
        "## 节点清单",
        "",
        "| id | 名称 | 难度 | 重要性 |",
        "|---|---|---|---|",
    ]
    for nid, n in sorted(nodes.items()):
        lines.append(f"| {nid} | {n.get('name','')} | {n.get('difficulty','')} | {n.get('importance','')} |")
    lines += ["", "## 题目清单（逐题校验）", "", "| qid | 题型 | 难度 | 知识点 | 来源文档 | 待核对项 |", "|---|---|---|---|---|---|"]
    for qid, q in sorted(questions.items()):
        node = next(iter((q.get("step_node_map") or {}).values()), "")
        src = "、".join(q.get("tags") or [])
        lines.append(f"| {qid} | {q.get('type')} | {q.get('difficulty')} | {node} | {src} | 事实/答案/难度 |")
    (out_dir / "审阅清单.md").write_text("\n".join(lines), encoding="utf-8")


def load_latest_user_key() -> str | None:
    """取可用 LLM key（优先 ye 等真实用户；跳过测试占位符 sk-secret/sk-xxx）。"""

    async def _load() -> str | None:
        async with get_session_factory()() as db:
            from sqlalchemy import select

            from app.persistence.models import User

            res = await db.execute(
                select(UserApiKey, User.username)
                .join(User, User.id == UserApiKey.user_id)
                .order_by(UserApiKey.id)
            )
            rows = [(row[0], row[1]) for row in res.all()]
        if not rows:
            return None
        # 优先 ye 账号（真实用户），其次 bailian provider，最后任意非占位符
        def real(k: str | None) -> bool:
            return bool(k) and not k.startswith(("sk-secret", "sk-xxx"))

        def dec(r) -> str | None:
            try:
                return decrypt_key(r.encrypted_key)
            except Exception:
                return None

        for r, uname in rows:
            if uname == "ye":
                k = dec(r)
                if real(k):
                    return k
        for r, _ in rows:
            if r.provider == "bailian":
                k = dec(r)
                if real(k):
                    return k
        for r, _ in rows:
            k = dec(r)
            if real(k):
                return k
        return None

    return asyncio.run(_load())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=r"D:\codexproject\codexproject\HireMind\xiaolinnote_knowledge")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / ".." / "domain_packs" / "llm_app_dev"))
    ap.add_argument("--dry", action="store_true", help="不调用 LLM，仅校验已有输出")
    ap.add_argument("--user-key", default=None, help="LLM key（默认自动取 user_api_keys 表最新一条）")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.dry:
        from app.domain.loader import load_pack

        try:
            pack = load_pack("llm_app_dev", base_dir=str(out_dir.parent))
            print(f"[ok] 领域包校验通过：{len(pack.graph.nodes)} 节点 / {len(pack.questions)} 题")
            return
        except Exception as e:
            print(f"[fail] 校验失败: {e}")
            sys.exit(1)

    src = Path(args.source)
    if not src.is_dir():
        print(f"[fail] 素材目录不存在: {src}")
        sys.exit(1)

    gw = LLMGateway()
    user_key = args.user_key or load_latest_user_key()
    if not user_key or user_key.startswith("sk-xxx"):
        print("[fail] 未找到可用 LLM key（user_api_keys 表为空或为占位符）；请用 --user-key 传入")
        sys.exit(1)
    print(f"[info] 使用用户 key（掩码 {user_key[:4]}****{user_key[-4:]}）生成领域包")
    out: dict = {"nodes": {}, "edges": set(), "questions": {}}
    gen_ctx = {"user_api_key": user_key}

    for topic, prefix in TOPIC_PREFIX.items():
        tdir = src / topic
        if not tdir.is_dir():
            print(f"[skip] 主题目录不存在: {tdir}")
            continue
        docs = sorted(tdir.glob("*.md"))
        # 索引文件（*_info.md）最后处理；每批 3 篇
        docs.sort(key=lambda p: (p.name.endswith("_info.md"), p.name))
        batch: list[tuple[str, str]] = []
        for d in docs:
            body = read_markdown(d)
            if len(body) < 200:
                continue
            batch.append((d.name, body))
            if len(batch) >= 3:
                parse_batch(gw, topic, prefix, batch, out, gen_ctx)
                batch = []
        if batch:
            parse_batch(gw, topic, prefix, batch, out, gen_ctx)

    if not out["nodes"]:
        print("[fail] 未生成任何节点（LLM 全部降级？检查系统 key 与网络）")
        sys.exit(1)

    # 写出领域包
    (out_dir / "pack_manifest.json").write_text(
        json.dumps({"id": "llm_app_dev", "version": "0.1.0", "subject": "大模型应用开发", "engine_version": ">=0.1"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "knowledge_graph.json").write_text(
        json.dumps({"nodes": list(out["nodes"].values()), "edges": [{"from": f, "to": t, "type": "prerequisite"} for f, t in sorted(out["edges"])]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "questions.json").write_text(
        json.dumps(list(out["questions"].values()), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "diagnostic_rules.json").write_text(
        json.dumps(build_diagnostic_rules(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "assessment_config.json").write_text(
        json.dumps(build_assessment(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_review_manifest(out_dir, out["nodes"], out["questions"])

    # 全量校验
    from app.domain.loader import load_pack

    try:
        pack = load_pack("llm_app_dev", base_dir=str(out_dir.parent))
        print(f"\n[ok] 领域包生成并校验通过：{len(pack.graph.nodes)} 节点 / {len(pack.questions)} 题")
        print(f"     输出目录: {out_dir}")
        print(f"     请人工审阅 {out_dir / '审阅清单.md'} 后使用")
    except Exception as e:
        print(f"[fail] 生成完成但校验失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
