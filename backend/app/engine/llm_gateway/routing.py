"""LLM 分层路由与按用户 key 解析（对齐 01 5 与 04 2.9）。

MODEL_ROUTING 为 JSON：{"role": "provider/model", ...}，
如 {"diagnostic": "deepseek/deepseek-chat", "tutor": "deepseek/deepseek-chat", "generate": "qwen/qwen-turbo"}。
key 优先级：用户自配（ctx.user_api_key）→ 系统级 LITELLM_API_KEYS（仅开发/测试/内部）。
"""

from __future__ import annotations

import json

DEFAULT_MODEL = "deepseek/deepseek-chat"

_ROLES = ("diagnostic", "tutor", "generate", "review")


def parse_model_routing(raw: str) -> dict[str, str]:
    """解析 MODEL_ROUTING JSON；非法/空则回退默认。"""
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: str(v) for k, v in data.items() if k in _ROLES}


def resolve_model(role: str, routing: dict[str, str]) -> str:
    """按角色取模型；无配置回退默认。"""
    return routing.get(role) or routing.get("tutor") or DEFAULT_MODEL


def resolve_api_key(user_api_key: str | None, system_key: str | None) -> str | None:
    """key 解析：用户自配优先，其次系统级（仅开发/测试用）。"""
    if user_api_key and not user_api_key.startswith("sk-xxx"):
        return user_api_key
    if system_key and not system_key.startswith("sk-xxx"):
        return system_key
    return None
