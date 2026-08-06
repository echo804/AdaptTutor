# -*- coding: utf-8 -*-
"""生成「大学英语（四六级→考研）」试验领域包。
- 归属主账号 ye（用其已配置的 LLM key）
- 素材：.tmp_packs/ce_src/（7 个主题目录）
- 产出：domain_packs/college_english/ + UserDomain(published, private)
"""
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select

from app.config import get_settings
from app.domain.loader import load_pack
from app.engine.pack_factory import generate_domain
from app.persistence.db import get_session_factory
from app.persistence.models import GenerationTask, User, UserDomain

SRC = Path(__file__).resolve().parent.parent / ".tmp_packs" / "ce_src"
PACK_ID = "college_english"


async def _report(pack_id: str) -> None:
    pack = load_pack(pack_id)
    dist = {qt: sum(1 for q in pack.questions if q.type == qt) for qt in ("choice", "blank", "open", "multi")}
    print(f"\n✅ 生成完成并发布:")
    print(f"   pack_id = {pack_id}")
    print(f"   subject = {pack.manifest.subject}")
    print(f"   节点数  = {len(pack.graph.nodes)}")
    print(f"   边数    = {len(pack.graph.edges)}")
    print(f"   题数    = {len(pack.questions)}")
    print(f"   题型分布 = {dist}")


async def main() -> None:
    factory = get_session_factory()
    async with factory() as db:
        user = (await db.execute(select(User).where(User.username == "ye"))).scalar_one_or_none()
        if user is None:
            print("!! 未找到主账号 ye")
            return
        # 已存在则续跑（上次可能中途失败）
        exist = (await db.execute(select(UserDomain).where(UserDomain.pack_id == PACK_ID))).scalar_one_or_none()
        if exist is not None:
            if exist.status == "published":
                print("!! 包已发布:", PACK_ID, "（跳过）")
                return
            print(f"续跑已存在的 draft 包: domain_id={exist.id}")
            task = GenerationTask(user_id=exist.user_id, domain_id=exist.id, status="running", progress=0, stage="准备")
            db.add(task)
            await db.commit()
            await generate_domain(exist.id, SRC)
            t = (await db.execute(select(GenerationTask).where(GenerationTask.domain_id == exist.id).order_by(GenerationTask.id.desc()).limit(1))).scalar_one()
            if t.status == "failed":
                print("!! 生成失败:", t.error)
                return
            exist.status = "published"
            await db.commit()
            await _report(exist.pack_id)
            return

        d = UserDomain(
            user_id=user.id,
            pack_id=PACK_ID,
            name="大学英语（四六级→考研）",
            description="书面综合：词根词缀/动词短语/定语从句/非谓语/虚拟语气/汉译英/写作结构（原创素材，试验包）",
            visibility="private",
            status="draft",
        )
        db.add(d)
        await db.commit()
        await db.refresh(d)
        task = GenerationTask(user_id=user.id, domain_id=d.id, status="running", progress=0, stage="准备")
        db.add(task)
        await db.commit()

        print(f"开始生成: domain_id={d.id} pack={PACK_ID} 主题数={len(list(SRC.iterdir()))}")
        await generate_domain(d.id, SRC)

        # 重新读取状态
        t = (await db.execute(select(GenerationTask).where(GenerationTask.domain_id == d.id).order_by(GenerationTask.id.desc()).limit(1))).scalar_one()
        if t.status == "failed":
            print("!! 生成失败:", t.error)
            return
        # 直接发布（私有包，无需审核）
        d.status = "published"
        await db.commit()

    pack = load_pack(PACK_ID)
    print(f"\n✅ 生成完成并发布:")
    print(f"   pack_id = {PACK_ID}")
    print(f"   subject = {pack.manifest.subject}")
    print(f"   节点数  = {len(pack.graph.nodes)}")
    print(f"   边数    = {len(pack.graph.edges)}")
    print(f"   题数    = {len(pack.questions)}")
    print(f"   题型分布 = {{}}".replace("{}", str({qt: sum(1 for q in pack.questions if q.type == qt) for qt in ("choice", "blank", "open", "multi")})))


asyncio.run(main())
