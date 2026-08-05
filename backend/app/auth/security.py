"""认证安全原语：bcrypt 哈希 + PyJWT（对齐 04 2.x：自研 JWT + bcrypt）。

- 密码：bcrypt 加盐哈希，永不明文存储
- Token：HS256（JWT_SECRET），过期时间 JWT_EXPIRE_MINUTES
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import get_settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_token(user_id: int, username: str) -> str:
    s = get_settings()
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc)
        + timedelta(minutes=s.jwt_expire_minutes),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    """解析并校验 token；无效/过期抛 ValueError。"""
    s = get_settings()
    try:
        return jwt.decode(token, s.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise ValueError("无效或已过期的登录凭证") from None
