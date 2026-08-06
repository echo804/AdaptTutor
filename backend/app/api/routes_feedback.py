"""用户反馈 API（M4r22）：右下角悬浮按钮提交 + 管理员查看列表。

- POST /me/feedback：提交反馈（content + category）
- GET /me/feedback：自己提交的反馈（最近 20 条）
- GET /admin/feedback：管理员查看全部反馈（is_admin 才可）
- PATCH /admin/feedback/{id}：管理员标记状态（read/done）
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.persistence.models import Feedback, User

router = APIRouter(tags=["feedback"])


@router.post("/me/feedback")
async def submit_feedback(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """提交反馈。content 必填，category 可选（bug|suggestion|question|other）。"""
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="反馈内容不能为空")
    if len(content) > 2000:
        raise HTTPException(status_code=400, detail="反馈内容过长（最多 2000 字）")
    category = body.get("category") or "other"
    if category not in ("bug", "suggestion", "question", "other"):
        category = "other"
    fb = Feedback(
        user_id=user.id,
        content=content,
        category=category,
        status="new",
        created_at=datetime.now(timezone.utc),
    )
    db.add(fb)
    await db.commit()
    await db.refresh(fb)
    return {"id": fb.id, "status": fb.status}


@router.get("/me/feedback")
async def my_feedback(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """自己提交的反馈（最近 20 条）。"""
    res = await db.execute(
        select(Feedback)
        .where(Feedback.user_id == user.id)
        .order_by(Feedback.created_at.desc())
        .limit(20)
    )
    items = [
        {
            "id": f.id,
            "content": f.content,
            "category": f.category,
            "status": f.status,
            "created_at": f.created_at.isoformat(),
        }
        for f in res.scalars().all()
    ]
    return {"items": items}


@router.get("/admin/feedback")
async def admin_feedback(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """管理员查看全部反馈（按新→旧）。"""
    if not (user.meta or {}).get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    res = await db.execute(
        select(Feedback).order_by(Feedback.created_at.desc()).limit(100)
    )
    items = [
        {
            "id": f.id,
            "user_id": f.user_id,
            "content": f.content,
            "category": f.category,
            "status": f.status,
            "created_at": f.created_at.isoformat(),
        }
        for f in res.scalars().all()
    ]
    return {"items": items}


@router.patch("/admin/feedback/{fb_id}")
async def update_feedback_status(
    fb_id: int,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """管理员标记反馈状态（read/done）。"""
    if not (user.meta or {}).get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    fb = await db.get(Feedback, fb_id)
    if fb is None:
        raise HTTPException(status_code=404, detail="反馈不存在")
    status = body.get("status")
    if status not in ("new", "read", "done"):
        raise HTTPException(status_code=400, detail="非法状态")
    fb.status = status
    await db.commit()
    return {"id": fb.id, "status": fb.status}


@router.delete("/me/feedback/{fb_id}")
async def delete_my_feedback(
    fb_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """删除自己的反馈（M4r22c）；管理员可删任意。"""
    fb = await db.get(Feedback, fb_id)
    if fb is None:
        raise HTTPException(status_code=404, detail="反馈不存在")
    is_admin = bool((user.meta or {}).get("is_admin"))
    if fb.user_id != user.id and not is_admin:
        raise HTTPException(status_code=403, detail="无权删除他人反馈")
    await db.delete(fb)
    await db.commit()
    return {"ok": True}


@router.delete("/admin/feedback/{fb_id}")
async def admin_delete_feedback(
    fb_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """管理员删除任意反馈（M4r22c）。"""
    if not (user.meta or {}).get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    fb = await db.get(Feedback, fb_id)
    if fb is None:
        raise HTTPException(status_code=404, detail="反馈不存在")
    await db.delete(fb)
    await db.commit()
    return {"ok": True}
