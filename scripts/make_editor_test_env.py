# -*- coding: utf-8 -*-
"""为 M6 编辑器手动闭环验证准备隔离环境（不碰真实账号）：
注册测试用户 + 复制 ud153 包为新包 + 插 UserDomain 记录。输出 token 与 pack_id。"""
import asyncio
import json
import shutil
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select

from app.config import get_settings
from app.persistence.db import get_session_factory
from app.persistence.models import InviteCode, User, UserDomain


async def main():
    factory = get_session_factory()
    uname = f"teditor_{uuid.uuid4().hex[:6]}"
    pwd = "secret123"
    pack_id = f"test_editor_{uuid.uuid4().hex[:8]}"

    async with factory() as db:
        # 邀请码
        code = f"inv-{uuid.uuid4().hex[:8]}"
        db.add(InviteCode(code=code, created_at=datetime.now(timezone.utc),
                          expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
        await db.commit()
        # 注册
        from app.auth.service import register as do_register
        from app.auth.security import create_token
        user = await do_register(db, uname, pwd, code)
        # 复制包
        from pathlib import Path
        root = Path(get_settings().domain_pack_path)
        src = root / "ud153_85923534_099b"
        dst = root / pack_id
        shutil.copytree(src, dst)
        mf = dst / "pack_manifest.json"
        m = json.loads(mf.read_text(encoding="utf-8"))
        m["id"] = pack_id
        mf.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
        # UserDomain
        db.add(UserDomain(user_id=user.id, pack_id=pack_id, name="编辑器验证包",
                          description="M6 手动闭环临时验证", visibility="private", status="published"))
        await db.commit()
        token = create_token(user.id, user.username)
        print(f"username={uname}")
        print(f"password={pwd}")
        print(f"pack_id={pack_id}")
        print(f"token={token}")


asyncio.run(main())
