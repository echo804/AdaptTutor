"""用户自建领域路由（M4r8d）：素材导入 → AI 生成（异步）→ 发布/审核。

- POST   /api/v1/user-domains            创建领域（上传 md/zip/文本）并启动异步生成
- GET    /api/v1/user-domains            我的领域列表（含任务状态）
- GET    /api/v1/user-domains/{id}/status 生成进度
- GET    /api/v1/user-domains/{id}/checklist 审阅清单
- POST   /api/v1/user-domains/{id}/publish 发布（私有直接发布；公开提交审核）
- DELETE /api/v1/user-domains/{id}       删除
- GET    /api/v1/admin/domains           管理员：审核队列
- POST   /api/v1/admin/domains/{id}/review 管理员：通过/拒绝
"""

import asyncio
import time
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.config import get_settings
from app.engine.pack_factory import _write_pack, generate_domain
from app.persistence.models import GenerationTask, User, UserDomain

router = APIRouter(prefix="/api/v1", tags=["user-domains"])


def _is_admin(user: User) -> bool:
    return bool((user.meta or {}).get("is_admin"))


async def _own_domain(db: AsyncSession, domain_id: int, user_id: int) -> UserDomain:
    d = await db.get(UserDomain, domain_id)
    if d is None or d.user_id != user_id:
        raise HTTPException(status_code=404, detail="领域不存在")
    return d


def _safe_extract_zip(zf: zipfile.ZipFile, target: Path) -> None:
    """安全解压：拒绝路径穿越（../、绝对路径）。"""
    for m in zf.infolist():
        name = m.filename
        p = (target / name).resolve()
        if not str(p).startswith(str(target.resolve())):
            raise HTTPException(status_code=400, detail=f"压缩包包含非法路径: {name}")
    zf.extractall(target)


async def _save_uploads(
    domain_id: int,
    files: list[UploadFile] | None,
    zip_file: UploadFile | None,
    text: str | None,
) -> Path:
    """素材落盘：临时目录 .tmp_packs/{domain_id}/；返回目录。"""
    base = Path(get_settings().domain_pack_path).parent / ".tmp_packs" / str(domain_id)
    if base.exists():
        import shutil

        shutil.rmtree(base, ignore_errors=True)
    general = base / "general"
    general.mkdir(parents=True, exist_ok=True)

    if zip_file and zip_file.filename and zip_file.filename.endswith(".zip"):
        zpath = base / "upload.zip"
        zpath.write_bytes(await zip_file.read())
        try:
            with zipfile.ZipFile(zpath) as zf:
                _safe_extract_zip(zf, base)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="上传的 zip 文件损坏")
        zpath.unlink(missing_ok=True)
        # 解压后可能含顶层目录；md 文件按所在子目录归主题
    for i, f in enumerate(files or []):
        if not f.filename or not f.filename.endswith((".md", ".markdown", ".txt")):
            continue
        (general / f"{i:02d}_{Path(f.filename).name}").write_bytes(await f.read())
    if text and text.strip():
        (general / "01_粘贴文本.md").write_text(text, encoding="utf-8")
    return base


@router.post("/user-domains/blank")
async def api_create_blank_domain(
    name: str = Form(""),
    description: str = Form(""),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """创建空白领域包：空图谱 + 空题库，直接进入编辑器手工构建。

    status 置 published（而非 draft）——draft 会被领域列表过滤且无「编辑」入口；
    visibility 固定 private（要公开共享走 /publish 审核流）。
    """
    if not (0 < len(name.strip()) <= 60):
        raise HTTPException(status_code=400, detail="名称需 1-60 字")
    pack_id = f"ud{user.id}_{int(time.time()) % 100000000}_{uuid.uuid4().hex[:4]}"
    out_dir = Path(get_settings().domain_pack_path) / pack_id
    _write_pack(out_dir, pack_id, name.strip(), {"nodes": {}, "edges": set(), "questions": {}})
    d = UserDomain(
        user_id=user.id,
        pack_id=pack_id,
        name=name.strip(),
        description=description.strip() or None,
        visibility="private",
        status="published",
        nodes_count=0,
        questions_count=0,
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return {"domain_id": d.id, "pack_id": pack_id, "status": "published"}


@router.post("/user-domains")
async def api_create_user_domain(
    name: str = Form(...),
    description: str = Form(""),
    visibility: str = Form("private"),
    files: list[UploadFile] | None = File(default=None),
    zip_file: UploadFile | None = File(default=None),
    text: str = Form(""),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """创建领域并启动异步 AI 生成。"""
    if not (0 < len(name) <= 60):
        raise HTTPException(status_code=400, detail="名称需 1-60 字")
    if visibility not in ("private", "public"):
        raise HTTPException(status_code=400, detail="visibility 需为 private/public")
    has_zip = bool(zip_file and zip_file.filename and zip_file.filename.endswith(".zip"))
    has_files = bool(files and any(f.filename for f in files))
    if not (has_zip or has_files or (text and text.strip())):
        raise HTTPException(status_code=400, detail="请上传 md 文件、zip 包或粘贴文本作为素材")

    pack_id = f"ud{user.id}_{int(time.time()) % 100000000}_{uuid.uuid4().hex[:4]}"
    d = UserDomain(
        user_id=user.id,
        pack_id=pack_id,
        name=name.strip(),
        description=description.strip() or None,
        visibility=visibility,
        status="draft",
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)

    source = await _save_uploads(d.id, files, zip_file, text)
    task = GenerationTask(user_id=user.id, domain_id=d.id, status="running", progress=0, stage="准备")
    db.add(task)
    await db.commit()

    # 后台异步生成（不阻塞响应）
    asyncio.create_task(generate_domain(d.id, source))

    return {"domain_id": d.id, "pack_id": pack_id, "status": "draft", "task_id": task.id}


@router.get("/user-domains")
async def api_list_user_domains(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """我的领域列表（含最新任务状态）。"""
    res = await db.execute(
        select(UserDomain, GenerationTask)
        .outerjoin(GenerationTask, GenerationTask.domain_id == UserDomain.id)
        .where(UserDomain.user_id == user.id)
        .order_by(UserDomain.id.desc())
    )
    items = []
    for d, t in res.all():
        items.append(
            {
                "id": d.id,
                "pack_id": d.pack_id,
                "name": d.name,
                "description": d.description,
                "visibility": d.visibility,
                "status": d.status,
                "reject_reason": d.reject_reason,
                "nodes_count": d.nodes_count,
                "questions_count": d.questions_count,
                "task": {"status": t.status, "progress": t.progress, "stage": t.stage, "error": t.error} if t else None,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
        )
    return {"items": items}


@router.get("/user-domains/{did}/status")
async def api_domain_status(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _own_domain(db, did, user.id)
    res = await db.execute(
        select(GenerationTask)
        .where(GenerationTask.domain_id == did)
        .order_by(GenerationTask.id.desc())
        .limit(1)
    )
    t = res.scalar_one_or_none()
    d = await db.get(UserDomain, did)
    return {
        "task_status": t.status if t else None,
        "progress": t.progress if t else 0,
        "stage": t.stage if t else None,
        "error": t.error if t else None,
        "domain_status": d.status if d else None,
        "nodes_count": d.nodes_count if d else None,
        "questions_count": d.questions_count if d else None,
    }


@router.get("/user-domains/{did}/checklist")
async def api_domain_checklist(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """审阅清单内容（生成完成后可读）。"""
    d = await _own_domain(db, did, user.id)
    path = Path(get_settings().domain_pack_path) / d.pack_id / "审阅清单.md"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="审阅清单尚未生成（任务可能未完成）")
    return {"checklist": path.read_text(encoding="utf-8")}


@router.post("/user-domains/{did}/publish")
async def api_publish_domain(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """发布：私有 → 直接 published；公开 → 提交审核（pending_review）。"""
    d = await _own_domain(db, did, user.id)
    if d.status == "draft":
        # 检查生成是否完成
        res = await db.execute(
            select(GenerationTask).where(GenerationTask.domain_id == did).order_by(GenerationTask.id.desc()).limit(1)
        )
        t = res.scalar_one_or_none()
        if t is None or t.status != "done":
            raise HTTPException(status_code=400, detail="领域仍在生成中，请等待完成")
    if d.visibility == "public":
        d.status = "pending_review"
    else:
        d.status = "published"
    await db.commit()
    return {"status": d.status}


@router.delete("/user-domains/{did}")
async def api_delete_domain(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    d = await _own_domain(db, did, user.id)
    pack_dir = Path(get_settings().domain_pack_path) / d.pack_id
    if pack_dir.is_dir():
        import shutil

        shutil.rmtree(pack_dir, ignore_errors=True)
    await db.delete(d)
    await db.commit()
    return {"removed": did}


# ---------- 管理员：审核 ----------

@router.get("/admin/domains")
async def api_admin_domains(
    status: str = "pending_review",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    res = await db.execute(
        select(UserDomain, User.username)
        .join(User, User.id == UserDomain.user_id)
        .where(UserDomain.status == status)
        .order_by(UserDomain.id.desc())
        .limit(50)
    )
    items = [
        {
            "id": d.id,
            "name": d.name,
            "description": d.description,
            "pack_id": d.pack_id,
            "username": uname,
            "nodes_count": d.nodes_count,
            "questions_count": d.questions_count,
        }
        for d, uname in res.all()
    ]
    return {"items": items}


@router.post("/admin/domains/{did}/review")
async def api_review_domain(
    did: int,
    approve: bool = Form(...),
    reason: str = Form(""),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    d = await db.get(UserDomain, did)
    if d is None:
        raise HTTPException(status_code=404, detail="领域不存在")
    d.status = "published" if approve else "rejected"
    d.reject_reason = None if approve else (reason or "未通过审核")
    await db.commit()
    return {"status": d.status}


# ---------- 举报（简化：举报即下架，管理员可复核） ----------

@router.post("/domains/report/{pack_id}")
async def api_report_domain(
    pack_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    res = await db.execute(select(UserDomain).where(UserDomain.pack_id == pack_id))
    d = res.scalar_one_or_none()
    if d is None:
        raise HTTPException(status_code=404, detail="领域不存在")
    if d.visibility == "public" and d.status == "published":
        d.status = "takedown"
        await db.commit()
        return {"status": "takedown"}
    return {"status": d.status}
