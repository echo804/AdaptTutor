# -*- coding: utf-8 -*-
"""诊断：模拟 /sessions/{sid}/cards 对真实会话 1851 的处理，定位"只看到一张卡"问题。"""
import asyncio
import sys

sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.persistence.models import Session, User
from app.persistence import repositories as repo
from app.api.routes_sessions import _new_orchestrator

ENGINE = create_async_engine("postgresql+asyncpg://adapt:adapt_dev_pw@localhost:5433/adapttutor")
SessionLocal = async_sessionmaker(ENGINE, expire_on_commit=False)


async def main():
    async with SessionLocal() as db:
        s = await db.get(Session, 1851)
        print("会话:", s.id, "type=", s.type, "status=", s.status)
        ctx = s.context or {}
        print("context keys:", list(ctx.keys()))
        print("pack_id:", ctx.get("pack_id"))
        print("sm.state:", (ctx.get("sm") or {}).get("state"))

        # 找到会话属主
        res = await db.execute(select(User).where(User.id == s.student_id))
        user = res.scalar_one()
        print("user:", user.id, user.username)

        t = await _new_orchestrator(ctx.get("pack_id"), db, user.id)
        t.restore_state(ctx)
        print("restore 后 verify_question:", t.verify_question.id if t.verify_question else None)
        print("restore 后 sm.state:", t.sm.state.value if t.sm.state else None)

        events = await repo.list_events_by_session(db, 1851, "answer")
        print("answer 事件数:", len(events))
        for ev in events:
            p = ev.payload or {}
            print("  qid=", p.get("qid"), "correct=", p.get("correct"), "has_question_snapshot=", bool(p.get("question")))

        # 复刻接口逻辑
        by_id = {q.id: q for q in t.pack.questions}
        latest = {}
        for ev in events:
            p = ev.payload or {}
            qid = p.get("qid")
            if not qid:
                continue
            q = None
            snap = p.get("question")
            if isinstance(snap, dict):
                from app.domain.schemas import Question
                try:
                    q = Question(**snap)
                except Exception:
                    q = None
            if q is None:
                q = by_id.get(qid)
            latest[qid] = {"qid": qid, "question": q.id if q else None}
        is_diag = s.type == "diagnostic"
        cur_q = t.current_question if is_diag else t.verify_question
        done = s.status == "completed" or cur_q is None
        items = [latest[k] for k in latest]
        if cur_q is not None and not done:
            items.append({"qid": cur_q.id, "question": cur_q.id, "answered": False})
        print("cards items 数:", len(items))
        for it in items:
            print("  ", it)


asyncio.run(main())
