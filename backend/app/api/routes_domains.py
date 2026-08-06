"""领域路由：包列表 + 用户激活偏好 + 用户可见自建领域（M4r8/d）+ 可视化编辑器 API（M6）。

- GET /api/v1/domains：系统预置包 + 用户可见自建领域 + 当前激活包
- PUT /me/active-pack：切换用户激活领域（进度按 pack 隔离）
- GET /domains/{pack_id}：包全量内容（编辑器加载，editable = 是否当前用户自建包）
- POST /domains/validate：编辑器保存前校验（不写盘，返回 {valid, errors}）
- PUT /domains/{pack_id}：保存编辑（仅自建包可写，schema 校验 + 写回 5 个 JSON）
"""

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.config import get_settings
from app.domain.loader import PACK_FILES, list_packs, load_pack
from app.domain.schemas import DomainPack
from app.persistence.models import User, UserDomain

router = APIRouter(prefix="/api/v1", tags=["domains"])


def _active_pack(user: User) -> str:
    return (user.meta or {}).get("active_pack") or get_settings().active_domain_pack


@router.get("/domains")
async def api_domains(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """可用领域包列表 + 当前激活包。

    packs = 系统预置包 + 用户可见的自建领域：
    - 自己的（已发布/待审核/驳回可见，草稿生成中也可见但标记 generating）
    - 他人的已发布公开领域
    """
    packs: list[dict] = list_packs()
    known = {p["id"] for p in packs}
    res = await db.execute(
        select(UserDomain).where(
            UserDomain.status.in_(["published", "pending_review", "rejected", "draft", "takedown"])
        )
    )
    for d in res.scalars().all():
        # 生成中（draft）的包目录可能未就绪，不进选择器（用户在"我的领域"页看进度）
        if d.status == "draft":
            continue
        visible = d.user_id == user.id or (d.visibility == "public" and d.status == "published")
        if not visible:
            continue
        if d.pack_id in known:
            continue
        # 选择器直接显示领域名（他人公开领域同样只显示名称，简洁不标注可见性）
        packs.append(
            {
                "id": d.pack_id,
                "subject": d.name,
                "version": "0.1.0",
                "owner": d.user_id == user.id,
                "status": d.status,
            }
        )
    return {"packs": packs, "active": _active_pack(user)}


@router.get("/market/domains")
async def api_market_domains(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """领域市场：所有已审核公开的领域（含作者/统计/创建时间）。"""
    res = await db.execute(
        select(UserDomain, User.username)
        .join(User, User.id == UserDomain.user_id)
        .where(UserDomain.visibility == "public", UserDomain.status == "published")
        .order_by(UserDomain.id.desc())
        .limit(100)
    )
    items = [
        {
            "id": d.id,
            "pack_id": d.pack_id,
            "name": d.name,
            "description": d.description,
            "username": uname,
            "nodes_count": d.nodes_count,
            "questions_count": d.questions_count,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "owner": d.user_id == user.id,
        }
        for d, uname in res.all()
    ]
    return {"items": items}


class ActivePackRequest(BaseModel):
    pack_id: str = Field(min_length=1, max_length=64)


@router.put("/me/active-pack")
async def api_set_active_pack(
    body: ActivePackRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """切换用户激活领域（校验包存在；进度数据按 pack 隔离互不干扰）。"""
    # 校验：系统包 或 用户可见自建领域
    if body.pack_id in {p["id"] for p in list_packs()}:
        pass
    else:
        res = await db.execute(select(UserDomain).where(UserDomain.pack_id == body.pack_id))
        d = res.scalar_one_or_none()
        visible = d is not None and (
            d.user_id == user.id or (d.visibility == "public" and d.status == "published")
        )
        if not visible:
            raise HTTPException(status_code=404, detail="领域包不存在")
    meta = dict(user.meta or {})
    meta["active_pack"] = body.pack_id
    user.meta = meta
    await db.commit()
    return {"active": body.pack_id}


# ---------------------------------------------------------------------------
# M6 可视化领域编辑器 API
# ---------------------------------------------------------------------------


def _validate_pack_extra(pack: DomainPack) -> None:
    """编辑器保存时的额外校验（pydantic 之外的业务规则）。

    - 节点 id 唯一
    - step_node_map 指向存在的节点
    - choice/multi 题选项至少 2 个，multi 答案字母不超选项范围
    - 题干非空
    - prerequisite 边无循环依赖（DFS 三色标记）
    """
    node_ids = [n.id for n in pack.graph.nodes]
    if len(node_ids) != len(set(node_ids)):
        raise ValueError("知识图谱节点 id 重复")
    nset = set(node_ids)

    for q in pack.questions:
        if not (q.content or "").strip():
            raise ValueError(f"题目 {q.id} 题干为空")
        for k, v in (q.step_node_map or {}).items():
            if v not in nset:
                raise ValueError(
                    f"题目 {q.id} 的 step_node_map[{k}] 指向不存在的节点 {v}"
                )
        if q.type in ("choice", "multi"):
            if not q.options or len(q.options) < 2:
                raise ValueError(f"题目 {q.id} 为 {q.type} 型但选项不足 2 个")
            if q.type == "multi" and isinstance(q.answer, list):
                letters = {chr(65 + i) for i in range(len(q.options))}
                for a in q.answer:
                    if a not in letters:
                        raise ValueError(f"题目 {q.id} 的答案字母 {a} 超出选项范围")

    # prerequisite 边无环
    adj = {nid: [] for nid in node_ids}
    for e in pack.graph.edges:
        adj.setdefault(e.from_, []).append(e.to)
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {nid: WHITE for nid in node_ids}

    def dfs(nid: str) -> None:
        color[nid] = GRAY
        for nxt in adj[nid]:
            if color[nxt] == GRAY:
                raise ValueError(f"知识图谱存在循环依赖: {nid} → {nxt}")
            if color[nxt] == WHITE:
                dfs(nxt)
        color[nid] = BLACK

    for nid in node_ids:
        if color[nid] == WHITE:
            dfs(nid)


def _load_pack_or_404(pack_id: str) -> DomainPack:
    try:
        return load_pack(pack_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="领域包不存在")
    except Exception as e:  # schema 校验失败也视为包不可用
        raise HTTPException(status_code=422, detail=f"领域包数据损坏: {e}")


@router.get("/domains/{pack_id}")
async def api_domain_detail(
    pack_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """包全量内容（编辑器加载）。editable = 是否当前用户的自建包（决定可否保存）。"""
    pack = _load_pack_or_404(pack_id)
    res = await db.execute(select(UserDomain).where(UserDomain.pack_id == pack_id))
    ud = res.scalar_one_or_none()
    editable = ud is not None and ud.user_id == user.id
    data = pack.model_dump(mode="json", by_alias=True)
    data["editable"] = editable
    return data


@router.post("/domains/validate")
async def api_domain_validate(
    body: dict,
    user: User = Depends(get_current_user),
) -> dict:
    """编辑器保存前校验（不写盘）。始终 200，错误在 body.errors。"""
    try:
        pack = DomainPack.model_validate(body)
        _validate_pack_extra(pack)
    except Exception as e:
        return {"valid": False, "errors": [str(e)]}
    return {"valid": True, "errors": []}


class DomainSaveResponse(BaseModel):
    ok: bool = True
    pack_id: str
    questions: int
    nodes: int


@router.put("/domains/{pack_id}")
async def api_domain_save(
    pack_id: str,
    body: DomainPack,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DomainSaveResponse:
    """保存编辑（仅自建包可写）。schema 校验 + 额外业务校验后写回 5 个 JSON。"""
    res = await db.execute(select(UserDomain).where(UserDomain.pack_id == pack_id))
    ud = res.scalar_one_or_none()
    if ud is None or ud.user_id != user.id:
        raise HTTPException(status_code=403, detail="只有领域所有者可以编辑该领域")
    if body.manifest.id != pack_id:
        raise HTTPException(status_code=422, detail="manifest.id 与包 id 不一致")

    try:
        _validate_pack_extra(body)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    root = Path(get_settings().domain_pack_path) / pack_id
    if not root.is_dir():
        raise HTTPException(status_code=404, detail="领域包目录不存在")

    data = body.model_dump(mode="json", by_alias=True)
    for key, fname in PACK_FILES.items():
        with open(root / fname, "w", encoding="utf-8") as f:
            json.dump(data[key], f, ensure_ascii=False, indent=1)
            f.write("\n")

    ud.nodes_count = len(body.graph.nodes)
    ud.questions_count = len(body.questions)
    await db.commit()

    return DomainSaveResponse(
        pack_id=pack_id,
        questions=len(body.questions),
        nodes=len(body.graph.nodes),
    )
