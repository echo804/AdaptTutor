"""用户 API key 管理（对齐 04 2.9 / 03 5.0）。

- 存储：Fernet 对称加密后入 user_api_keys 表（加密密钥 API_KEY_ENC_KEY 在 .env）
- 展示：仅掩码（sk-****abcd），不可回读明文
- 读取：get_decrypted_key 供 llm_gateway 按用户 key 路由使用
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.persistence.models import UserApiKey


def _fernet() -> Fernet:
    s = get_settings()
    key = s.api_key_enc_key
    try:
        return Fernet(key.encode("utf-8"))
    except Exception:
        # 开发用任意字符串：SHA256 派生合法 Fernet key
        digest = hashlib.sha256(key.encode("utf-8")).digest()
        derived = base64.urlsafe_b64encode(digest)
        return Fernet(derived)


def encrypt_key(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_key(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")


def mask_key(plaintext: str) -> str:
    """掩码：sk-****abcd（不可回读明文）。"""
    if len(plaintext) <= 8:
        return "****"
    return plaintext[:4] + "****" + plaintext[-4:]


async def set_user_key(
    db: AsyncSession, user_id: int, provider: str, plaintext: str
) -> None:
    """配置/更新某供应商 key（Fernet 加密 upsert）。"""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    res = await db.execute(
        select(UserApiKey).where(
            UserApiKey.user_id == user_id, UserApiKey.provider == provider
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        row = UserApiKey(
            user_id=user_id,
            provider=provider,
            encrypted_key=encrypt_key(plaintext),
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.encrypted_key = encrypt_key(plaintext)
        row.updated_at = now
    await db.commit()


async def list_user_keys(db: AsyncSession, user_id: int) -> list[dict]:
    """已配置供应商列表（仅掩码）。"""
    res = await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == user_id)
    )
    return [
        {"provider": r.provider, "masked_key": mask_key(decrypt_key(r.encrypted_key))}
        for r in res.scalars().all()
    ]


async def get_decrypted_key(
    db: AsyncSession, user_id: int, provider: str
) -> str | None:
    """解密取回明文 key（llm_gateway 用，严禁返回前端）。"""
    res = await db.execute(
        select(UserApiKey).where(
            UserApiKey.user_id == user_id, UserApiKey.provider == provider
        )
    )
    row = res.scalar_one_or_none()
    return decrypt_key(row.encrypted_key) if row is not None else None


async def delete_user_key(db: AsyncSession, user_id: int, provider: str) -> bool:
    res = await db.execute(
        select(UserApiKey).where(
            UserApiKey.user_id == user_id, UserApiKey.provider == provider
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True
