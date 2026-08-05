"""领域包生成服务（M4r8d：用户自助创建领域）。

- 素材：上传的 md 文件（按子目录/文件名分主题）/ zip / 粘贴文本
- 生成：分批调 LLM 提炼 图谱节点/边 + 三档题 → 汇总去重 → schema 校验 → 审阅清单
- 异步：generate_domain 在后台任务执行，按主题更新进度（generation_tasks）
- 目录名 → 前缀：优先固定映射（llm→l 等），其余自动分配（p1/p2…）
"""

import asyncio
import json
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.loader import load_pack
from app.engine.llm_gateway.gateway import LLMGateway
from app.keys.service import decrypt_key
from app.persistence.db import get_session_factory
from app.persistence.models import GenerationTask, UserApiKey, UserDomain

# 固定主题映射（兼容 llm_app_dev 风格素材目录）
FIXED_PREFIX = {"llm": "l", "rag": "r", "agent": "a", "tools": "t", "overview": "o"}

SYSTEM_PROMPT = """你是领域包内容生成器。根据给定的中文技术文档，提炼该领域的知识图谱与学习题目，只输出一个 JSON 对象（不要 markdown 代码块包裹）：

{
  "nodes": [{"id": "l01", "name": "知识点名称", "difficulty": 0.5, "importance": 0.8, "error_modes": ["常见错因"]}],
  "edges": [{"from": "l01", "to": "l02", "type": "prerequisite"}],
  "questions": [
    {"id": "lq001", "type": "choice", "content": "题干", "difficulty": 0.5, "options": ["A. …", "B. …", "C. …", "D. …"], "answer": "B", "error_modes": ["错因"], "tags": ["来源文档.md"], "step_node_map": {"step1": "l01"}}
  ]
}

硬性要求：
1. 节点 id 用我提供的前缀（如 l01/l02…），name 是知识点名词短语（8-20 字），difficulty 0.3-0.75，importance 0.4-0.9。
2. 每篇文档提炼 1-2 个节点；边只画「前置依赖」（from 是 to 的前提），只能引用本批节点。
3. 每 2-3 个节点配 2-3 道题：覆盖 choice（4 选项，answer 为正确选项字母）/ blank（答案≤12字）/ open（答案=要点 1-3 句）。
4. 题目必须基于文档真实内容，禁止编造；error_modes 填最常见错因；tags 填来源文档文件名。
5. 题目 id 形如 {前缀}q001，全局唯一。"""


def assign_prefixes(dir_names: list[str]) -> dict[str, str]:
    """目录名 → 节点前缀：固定映射优先，其余自动分配 p1/p2…"""
    out: dict[str, str] = {}
    n = 1
    for d in dir_names:
        if d in FIXED_PREFIX:
            out[d] = FIXED_PREFIX[d]
        else:
            out[d] = f"p{n}"
            n += 1
    return out


def read_markdown(path: Path) -> str:
    """读 md：剥离 frontmatter，清理噪音，截断。"""
    raw = path.read_text(encoding="utf-8", errors="replace")
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            raw = parts[2]
    raw = re.sub(r"!\[.*?\]\(.*?\)", "", raw)
    raw = re.sub(r"<[^>]+>", "", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()[:4000]


def extract_json(text: str) -> dict:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("LLM 输出不含 JSON")
    return json.loads(t[start : end + 1])


def _normalize_question(q: dict, valid_nodes: set[str]) -> dict:
    em = q.get("error_modes")
    if isinstance(em, str):
        em = [em]
    q["error_modes"] = em or []
    q["options"] = q.get("options") or []
    smap = q.get("step_node_map") or {}
    smap = {k: v for k, v in smap.items() if v in valid_nodes}
    if not smap and valid_nodes:
        smap = {"step1": next(iter(valid_nodes))}
    q["step_node_map"] = smap
    return q


async def get_generation_key(user_id: int) -> str | None:
    """取该用户自配 key；无则回落任意真实用户 key（跳过占位符）。"""

    async def _real_key(session: AsyncSession, uid: int | None) -> str | None:
        stmt = select(UserApiKey)
        if uid is not None:
            stmt = stmt.where(UserApiKey.user_id == uid)
        res = await session.execute(stmt.order_by(UserApiKey.id))
        for row in res.scalars().all():
            try:
                k = decrypt_key(row.encrypted_key)
            except Exception:
                continue
            if k and not k.startswith(("sk-secret", "sk-xxx")):
                return k
        return None

    factory = get_session_factory()
    async with factory() as db:
        k = await _real_key(db, user_id)
        if k:
            return k
        return await _real_key(db, None)


def _parse_batch(gw: LLMGateway, topic: str, prefix: str, docs: list[tuple[str, str]], out: dict, gen_ctx: dict) -> int:
    """同步生成一批；返回本批题数。"""
    n_existing = sum(1 for k in out["nodes"] if k.startswith(prefix))
    q_existing = sum(1 for k in out["questions"] if k.startswith(prefix + "q"))
    start, qstart = n_existing + 1, q_existing + 1
    prompt = SYSTEM_PROMPT
    prompt += f"\n=== 主题：{topic}（节点前缀 {prefix}，从 {prefix}{start:02d} 起连续编号；题目前缀 {prefix}q 从 {prefix}q{qstart:03d} 起）===\n"
    for name, body in docs:
        prompt += f"\n【文档 {name}】\n{body}\n"
    resp = gw.generate("generate", prompt, ctx={**gen_ctx, "max_tokens": 4000, "temperature": 0.4})
    if resp.mock or resp.level >= 2:
        return 0
    data = extract_json(resp.text)
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
            out["questions"][qid] = _normalize_question(q, set(out["nodes"].keys()))
    return len(data.get("questions", []))


def _write_pack(out_dir: Path, pack_id: str, subject: str, out: dict) -> tuple[int, int]:
    """写领域包 5 文件 + 审阅清单；返回 (节点数, 题数)。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "pack_manifest.json").write_text(
        json.dumps({"id": pack_id, "version": "0.1.0", "subject": subject, "engine_version": ">=0.1"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "knowledge_graph.json").write_text(
        json.dumps({"nodes": list(out["nodes"].values()), "edges": [{"from": f, "to": t, "type": "prerequisite"} for f, t in sorted(out["edges"])]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "questions.json").write_text(json.dumps(list(out["questions"].values()), ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "diagnostic_rules.json").write_text(
        json.dumps({"initial_strategy": "weakest_node", "termination": {"confidence_threshold": 0.8, "max_questions": 15}, "bkt": {"p_l0": 0.3, "p_t": 0.05, "p_g": 0.2, "p_s": 0.1}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "assessment_config.json").write_text(
        json.dumps({"purity_threshold": 0.9, "mastery_threshold": 0.85, "regression_suite": []}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    _write_checklist(out_dir, out["nodes"], out["questions"])
    return len(out["nodes"]), len(out["questions"])


def _write_checklist(out_dir: Path, nodes: dict, questions: dict) -> None:
    lines = [
        "# 审阅清单",
        "",
        f"- 图谱节点：{len(nodes)} 个　题目：{len(questions)} 道",
        "- 人工审阅要求：逐题核对事实正确性/难度/选项唯一性/知识点映射；改后可重新生成",
        "",
        "## 节点清单",
        "",
        "| id | 名称 | 难度 | 重要性 |",
        "|---|---|---|---|",
    ]
    for nid, n in sorted(nodes.items()):
        lines.append(f"| {nid} | {n.get('name','')} | {n.get('difficulty','')} | {n.get('importance','')} |")
    lines += ["", "## 题目清单", "", "| qid | 题型 | 难度 | 知识点 | 来源文档 | 待核对项 |", "|---|---|---|---|---|---|"]
    for qid, q in sorted(questions.items()):
        node = next(iter((q.get("step_node_map") or {}).values()), "")
        src = "、".join(q.get("tags") or [])
        lines.append(f"| {qid} | {q.get('type')} | {q.get('difficulty')} | {node} | {src} | 事实/答案/难度 |")
    (out_dir / "审阅清单.md").write_text("\n".join(lines), encoding="utf-8")


async def _update_task(db: AsyncSession, task_id: int, **kw) -> None:
    t = await db.get(GenerationTask, task_id)
    if t is None:
        return
    for k, v in kw.items():
        setattr(t, k, v)
    await db.commit()


async def generate_domain(domain_id: int, source_dir: Path) -> None:
    """后台异步生成：更新 generation_tasks 进度，产出领域包。"""
    factory = get_session_factory()
    async with factory() as db:
        d = await db.get(UserDomain, domain_id)
        t = await db.execute(select(GenerationTask).where(GenerationTask.domain_id == domain_id).order_by(GenerationTask.id.desc()).limit(1))
        task = t.scalar_one_or_none()
        if d is None or task is None:
            return
        try:
            key = await get_generation_key(d.user_id)
            if not key:
                raise RuntimeError("未找到可用 LLM key，请在设置页配置后重试")
            gw = LLMGateway()
            gen_ctx = {"user_api_key": key}

            # 素材扫描：子目录 = 主题；无子目录则整体一个主题
            subdirs = [p for p in sorted(source_dir.iterdir()) if p.is_dir()]
            if subdirs:
                topics = {p.name: p for p in subdirs}
            else:
                topics = {"general": source_dir}
            prefix_map = assign_prefixes(list(topics.keys()))
            total_topics = len(topics)

            out: dict = {"nodes": {}, "edges": set(), "questions": {}}
            done = 0
            for tname, tdir in topics.items():
                await _update_task(db, task.id, stage=tname, progress=int(done / max(total_topics, 1) * 100))
                files = sorted(tdir.glob("*.md"))
                files.sort(key=lambda p: p.name.endswith("_info.md"))
                batch: list[tuple[str, str]] = []
                for f in files:
                    body = read_markdown(f)
                    if len(body) < 100:  # 短素材也接受（M4r8d：用户粘贴短文）
                        continue
                    batch.append((f.name, body))
                    if len(batch) >= 3:
                        await asyncio.to_thread(_parse_batch, gw, tname, prefix_map[tname], batch, out, gen_ctx)
                        batch = []
                if batch:
                    await asyncio.to_thread(_parse_batch, gw, tname, prefix_map[tname], batch, out, gen_ctx)
                done += 1
                await _update_task(db, task.id, progress=int(done / max(total_topics, 1) * 100))

            if not out["nodes"]:
                raise RuntimeError("素材未生成任何知识点（文档过少或 LLM 调用失败），请检查素材后重试")

            from app.config import get_settings

            pack_dir = Path(get_settings().domain_pack_path) / d.pack_id
            nn, qn = await asyncio.to_thread(_write_pack, pack_dir, d.pack_id, d.name, out)
            load_pack(d.pack_id)  # 全量校验（fast fail）
            d.nodes_count = nn
            d.questions_count = qn
            await _update_task(db, task.id, status="done", progress=100, stage="完成", finished_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc))
            await db.commit()
        except Exception as e:  # noqa: BLE001
            import datetime

            await _update_task(db, task.id, status="failed", error=str(e)[:400], stage="失败", finished_at=datetime.datetime.now(datetime.timezone.utc))
            await db.commit()
