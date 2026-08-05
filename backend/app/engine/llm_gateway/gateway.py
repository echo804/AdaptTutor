"""LLM 网关（对齐 03 引擎层 / 01 5 / 04 2.9）。

- generate(role, prompt, ctx)：统一入口，LiteLLM 封装
- 分层路由：role → 模型（MODEL_ROUTING）
- 按用户 key：ctx.user_api_key 优先，系统级 LITELLM_API_KEYS 仅开发/测试
- 三层降级：正常 → 备用模型 → 模板话术（→ 编排层可显式 offline）
- mock 模式：无真实 key 时自动启用（确定性模板回复，供 CLI/测试/无 key 用户）
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings, get_settings
from app.engine.llm_gateway.degradation import DegradeResult, degrade, offline
from app.engine.llm_gateway.routing import parse_model_routing, resolve_api_key, resolve_model
from app.engine.llm_gateway import templates


@dataclass
class GatewayResponse:
    text: str
    model: str
    level: int      # 0 正常 / 1 备用模型 / 2 模板话术 / 3 离线
    mock: bool      # mock 模式（无真实 key）标记


class LLMGateway:
    def __init__(self, settings: Settings | None = None) -> None:
        settings = settings or get_settings()
        self.routing: dict[str, str] = parse_model_routing(settings.model_routing)
        self.system_key: str | None = settings.litellm_api_keys or None

    def generate(
        self,
        role: str,
        prompt: str,
        ctx: dict | None = None,
    ) -> GatewayResponse:
        """生成回复。

        ctx 支持: user_api_key / max_tokens / temperature。
        无真实 key → mock；调用失败 → 降级链。
        """
        ctx = ctx or {}
        key = resolve_api_key(ctx.get("user_api_key"), self.system_key)
        if key is None:
            return self._mock(role)

        model = resolve_model(role, self.routing)
        try:
            import litellm

            resp = litellm.completion(
                model=model,
                api_key=key,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=ctx.get("max_tokens", 300),
                temperature=ctx.get("temperature", 0.6),
            )
            text = (resp.choices[0].message.content or "").strip()
            if not text:
                raise RuntimeError("empty completion")
            return GatewayResponse(text=text, model=model, level=0, mock=False)
        except Exception:
            d: DegradeResult = degrade(role, prompt, key, self.routing, model)
            return GatewayResponse(
                text=d.text, model=d.model, level=d.level, mock=False
            )

    def offline_reply(self) -> GatewayResponse:
        """L3 离线提示（编排层在降级链末端显式触发）。"""
        d = offline()
        return GatewayResponse(text=d.text, model=d.model, level=d.level, mock=False)

    def _mock(self, role: str) -> GatewayResponse:
        return GatewayResponse(
            text=templates.fallback_for(role), model="mock", level=2, mock=True
        )
