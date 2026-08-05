"""三层降级（对齐 04 1.6 / 02 硬指标"LLM 降级成功率 ≥ 99%"）。

L1 切备用模型 → L2 模板话术 → L3 离线提示。
level 语义（与 GatewayResponse 共用）：
  0 = 正常  1 = 备用模型  2 = 模板话术  3 = 离线提示
"""

from __future__ import annotations

from dataclasses import dataclass

from app.engine.llm_gateway import templates


@dataclass
class DegradeResult:
    text: str
    model: str
    level: int  # 1/2/3
    mock: bool = False


def try_backup_model(
    role: str,
    prompt: str,
    api_key: str,
    routing: dict[str, str],
    primary_model: str,
) -> tuple[str, str] | None:
    """L1：尝试备用模型（路由中任一不同于主模型的候选）。失败返回 None。"""
    backup = next((m for m in routing.values() if m != primary_model), None)
    if backup is None:
        return None
    try:
        import litellm

        resp = litellm.completion(
            model=backup,
            api_key=api_key,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=256,
        )
        text = (resp.choices[0].message.content or "").strip()
        return (text, backup) if text else None
    except Exception:
        return None


def degrade(
    role: str,
    prompt: str,
    api_key: str,
    routing: dict[str, str],
    primary_model: str,
) -> DegradeResult:
    """降级链：L1 备用模型 → L2 模板话术。"""
    backup = try_backup_model(role, prompt, api_key, routing, primary_model)
    if backup is not None:
        text, model = backup
        return DegradeResult(text=text, model=model, level=1)
    return DegradeResult(
        text=templates.fallback_for(role), model=primary_model, level=2
    )


def offline() -> DegradeResult:
    """L3：离线提示（编排层显式触发，如模板回复仍被拒答/自检拦截）。"""
    return DegradeResult(text=templates.OFFLINE_PROMPT, model="offline", level=3)
