"""API 请求/响应模型（pydantic，对齐 03 5.0-5.3）。"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ---- auth ----

class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    invite_code: str | None = None  # 首用户可省略（04 v0.8）


class BootstrapResponse(BaseModel):
    needs_invite: bool  # users 表非空时需要邀请码


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user_id: int
    username: str


class MeResponse(BaseModel):
    user_id: int
    username: str


# ---- keys ----

class KeyPutRequest(BaseModel):
    provider: str = Field(pattern="^(deepseek|qwen|glm|bailian)$")
    api_key: str = Field(min_length=8)


class KeyItem(BaseModel):
    provider: str
    masked_key: str


class BailianModel(BaseModel):
    id: str          # LiteLLM 模型名（dashscope/ 前缀）
    label: str


class SettingsPutRequest(BaseModel):
    bailian_models: dict[str, str] | None = None  # {"tutor": "...", "generate": "..."}


# ---- sessions / 消息 ----

class SessionCreateRequest(BaseModel):
    type: str = Field(pattern="^(diagnostic|tutor|review)$")


class SessionCreated(BaseModel):
    session_id: int
    type: str
    status: str
    first_message: str | None = None
    question: dict | None = None  # 诊断首题（M4 前端作答按钮用）


class MessageSendRequest(BaseModel):
    kind: str = Field(pattern="^(answer|message)$")  # answer=作答（AI 判题）/ message=辅导对话
    answer: str | None = None        # kind=answer：选择题传选项字母，填空/解答传文本
    correct: bool | None = None      # 兼容旧字段（M4r1 后由 AI 判题，前端不再传）
    content: str = ""                # 学生回复文本


class MessageReply(BaseModel):
    state: str
    message: str
    degraded: bool = False
    mock: bool = False
    question: dict | None = None      # 诊断下一题（kind=answer）
    terminated: bool = False
    done: bool = False
    correct: bool | None = None       # AI 判题结果（M4r1）
    feedback: str | None = None       # 判题反馈
    judge_method: str | None = None   # choice|rule|llm


class SessionDetail(BaseModel):
    session_id: int
    type: str
    status: str
    state: str | None = None
    context: dict | None = None


class SessionItem(BaseModel):
    id: int
    type: str
    status: str
    created_at: str


class SessionList(BaseModel):
    sessions: list[SessionItem]


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    trace_id: str
    created_at: str


# ---- students ----

class MasteryOut(BaseModel):
    mastery: dict[str, float]
    weakest: str | None = None


class PathOut(BaseModel):
    path: list[str]


class TraceOut(BaseModel):
    wrong_node: str
    root: str
    chain: list[str]
