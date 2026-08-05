"""LLM 网关测试：路由解析、mock 模式、用户 key 优先、故障注入降级。"""

from types import SimpleNamespace

import pytest

from app.config import Settings
from app.engine.llm_gateway import templates
from app.engine.llm_gateway.gateway import LLMGateway
from app.engine.llm_gateway.routing import (
    parse_model_routing,
    resolve_api_key,
    resolve_model,
)


def _settings(**overrides) -> Settings:
    base = dict(
        database_url="postgresql://t/t",
        api_key_enc_key="k",
        jwt_secret="s" * 16,
        litellm_api_keys="",
        model_routing='{"diagnostic":"deepseek/deepseek-chat","tutor":"deepseek/deepseek-chat","generate":"qwen/qwen-turbo"}',
    )
    base.update(overrides)
    return Settings(**base)


# ---- 路由解析 ----

def test_parse_model_routing_ok():
    r = parse_model_routing('{"tutor":"deepseek/deepseek-chat","generate":"qwen/qwen-turbo"}')
    assert r["tutor"] == "deepseek/deepseek-chat"
    assert "diagnostic" not in r


def test_parse_model_routing_invalid():
    assert parse_model_routing("not-json") == {}
    assert parse_model_routing("") == {}


def test_resolve_model_fallback():
    r = parse_model_routing('{"tutor":"deepseek/deepseek-chat"}')
    assert resolve_model("generate", r) == "deepseek/deepseek-chat"
    assert resolve_model("nope", {}) == "deepseek/deepseek-chat"


def test_resolve_api_key_priority():
    assert resolve_api_key("sk-user-1", "sk-sys-1") == "sk-user-1"
    assert resolve_api_key(None, "sk-sys-1") == "sk-sys-1"
    assert resolve_api_key("sk-xxx", "sk-sys-1") == "sk-sys-1"
    assert resolve_api_key(None, "sk-xxx") is None


# ---- mock 模式（无真实 key） ----

def test_mock_mode_without_key():
    gw = LLMGateway(_settings(litellm_api_keys="sk-xxx"))
    r = gw.generate("tutor", "请讲解")
    assert r.mock is True
    assert r.level == 2
    assert r.text  # 确定性模板话术


def test_mock_mode_no_key_at_all():
    gw = LLMGateway(_settings(litellm_api_keys=""))
    r = gw.generate("diagnostic", "开始")
    assert r.mock is True


# ---- 用户 key 优先 + 正常调用 ----

def test_user_key_used_and_normal_response(monkeypatch):
    calls: list[str] = []

    def fake_completion(**kwargs):
        calls.append(kwargs.get("api_key"))
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="好，继续。"))]
        )

    monkeypatch.setattr("litellm.completion", fake_completion)
    gw = LLMGateway(_settings(litellm_api_keys="sk-sys-1"))
    r = gw.generate("tutor", "p", ctx={"user_api_key": "sk-user-1"})
    assert r.mock is False and r.level == 0
    assert calls == ["sk-user-1"]
    assert "继续" in r.text


# ---- 故障注入：三层降级 ----

def test_degrade_to_backup_model(monkeypatch):
    """主模型失败 → 备用模型成功 → level=1。"""
    state = {"n": 0}

    def flaky(**kwargs):
        state["n"] += 1
        if kwargs["model"] == "deepseek/deepseek-chat":
            raise RuntimeError("provider down")
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="备用模型回复"))]
        )

    monkeypatch.setattr("litellm.completion", flaky)
    gw = LLMGateway(
        _settings(
            litellm_api_keys="sk-sys-1",
            model_routing='{"tutor":"deepseek/deepseek-chat","diagnostic":"qwen/qwen-turbo"}',
        )
    )
    r = gw.generate("tutor", "p")
    assert r.level == 1
    assert r.mock is False
    assert state["n"] == 2  # 主 + 备用各一次


def test_degrade_to_template_when_all_fail(monkeypatch):
    """主/备用均失败 → 模板话术 level=2。"""

    def boom(**kwargs):
        raise RuntimeError("all down")

    monkeypatch.setattr("litellm.completion", boom)
    gw = LLMGateway(_settings(litellm_api_keys="sk-sys-1"))
    r = gw.generate("tutor", "p")
    assert r.level == 2
    assert r.text == templates.fallback_for("tutor")


def test_offline_explicit():
    gw = LLMGateway(_settings(litellm_api_keys="sk-sys-1"))
    r = gw.offline_reply()
    assert r.level == 3
    assert r.text == templates.OFFLINE_PROMPT


# ---- 模板话术 ----

def test_template_by_role_fill():
    t = templates.by_role("diagnostic", question="1+1=?")
    assert "1+1=?" in t


def test_template_unknown_role_fallback():
    assert templates.by_role("unknown_role")
