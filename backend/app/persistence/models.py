"""PG 数据模型（对齐 docs/03-项目架构.md 第 3 节 + docs/04-需求决策记录.md）。

用户即学习者：无独立 students 表，sessions/mastery_states/learning_events 的
student_id 即 users.id（04 决策）。
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    """账号 + 学生档案（用户即学习者）。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class UserApiKey(Base):
    """用户自配 LLM key（Fernet 加密存储，04 2.9）。"""

    __tablename__ = "user_api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32))  # deepseek|qwen|glm
    encrypted_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_user_api_keys_user_provider"),
    )


class InviteCode(Base):
    """邀请码注册（CLI 生成、一次性、过期失效）。"""

    __tablename__ = "invite_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    # M4r19：生成者（用于「我的邀请码」列表/持有上限）；NULL = 早期 CLI 生成的旧码
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    used_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Session(Base):
    """会话（任务状态持久化于此，重启可恢复）。"""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True
    )
    type: Mapped[str] = mapped_column(String(16))  # diagnostic|tutor|review
    status: Mapped[str] = mapped_column(String(16), default="active")
    context: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # 状态机快照+掌握度
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Message(Base):
    """每轮消息（含评估分）。"""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id"), index=True
    )
    trace_id: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user|assistant|system
    content: Mapped[str] = mapped_column(Text)
    purity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MasteryState(Base):
    """掌握度（BKT 概率）。"""

    __tablename__ = "mastery_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True
    )
    # M4r8：领域包维度（多领域进度隔离；默认 junior_math_eq_ineq 兼容存量）
    pack_id: Mapped[str] = mapped_column(
        String(64), default="junior_math_eq_ineq", server_default="junior_math_eq_ineq"
    )
    node_id: Mapped[str] = mapped_column(String(64))
    mastery_p: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    last_review_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decay_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "student_id", "pack_id", "node_id", name="uq_mastery_states_student_pack_node"
        ),
    )


class LearningEvent(Base):
    """事件流（评估/回溯唯一依据）。"""

    __tablename__ = "learning_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True
    )
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("sessions.id"), nullable=True
    )
    # M4r8：领域包维度（错题/趋势按领域隔离；存量默认 junior_math_eq_ineq）
    pack_id: Mapped[str | None] = mapped_column(
        String(64), default="junior_math_eq_ineq", server_default="junior_math_eq_ineq", nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(32))
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Evaluation(Base):
    """诊断结果/溯源路径/纯度评分。"""

    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id"), index=True
    )
    eval_type: Mapped[str] = mapped_column(String(32))  # diagnosis|trace|purity
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class QuestionBank(Base):
    """题库（embedding 预留）。"""

    __tablename__ = "question_bank"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_pack: Mapped[str] = mapped_column(String(64), index=True)
    content: Mapped[dict] = mapped_column(JSONB)
    tags: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    difficulty: Mapped[float] = mapped_column(Float)
    error_modes: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    step_node_map: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    embedding: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # 预留


class KnowledgeGraph(Base):
    """图谱（JSONB）。"""

    __tablename__ = "knowledge_graph"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_pack: Mapped[str] = mapped_column(String(64), index=True)
    graph_jsonb: Mapped[dict] = mapped_column(JSONB)
    version: Mapped[str] = mapped_column(String(16))


class ReviewSchedule(Base):
    """SM-2 间隔重复调度（M6 遗忘调度升级）：错题跨会话复习计划。

    答错 → 入表（interval=1 天）；到期（due_at <= now）优先出现在辅导/诊断选题中；
    复习答对 → repetitions+1、间隔按 ease 倍增；再答错 → 重置为 1 天并衰减 ease。
    """

    __tablename__ = "review_schedule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    pack_id: Mapped[str] = mapped_column(String(64), index=True)
    qid: Mapped[str] = mapped_column(String(64))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)  # 下次复习时间
    interval_days: Mapped[int] = mapped_column(Integer, default=1)  # 当前间隔（天）
    ease: Mapped[float] = mapped_column(Float, default=2.5)  # 易度因子（下限 1.3）
    repetitions: Mapped[int] = mapped_column(Integer, default=0)  # 连续答对次数
    last_result: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    __table_args__ = (
        UniqueConstraint("user_id", "pack_id", "qid", name="uq_review_user_pack_qid"),
    )


class UserDomain(Base):
    """用户自建领域（M4r8d）：素材导入 → AI 生成 → 发布/审核。

    visibility: private（仅创建者可见）/ public（公开共享，需审核）
    status: draft（生成中/未完成）→ published / pending_review / rejected / takedown
    """

    __tablename__ = "user_domains"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    pack_id: Mapped[str] = mapped_column(String(64), unique=True)  # 领域包目录名（ud{uid}_{ts}）
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[str] = mapped_column(String(16), default="private")  # private|public
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|published|pending_review|rejected|takedown
    reject_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    nodes_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    questions_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class GenerationTask(Base):
    """领域生成任务（M4r8d）：异步执行 + 进度（浏览器可轮询）。"""

    __tablename__ = "generation_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    domain_id: Mapped[int | None] = mapped_column(
        ForeignKey("user_domains.id", ondelete="CASCADE"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="running")  # running|done|failed
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0-100
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 当前阶段（主题名）
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Feedback(Base):
    """用户反馈（M4r22）：右下角悬浮按钮提交，管理员可查看。"""

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    content: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32), default="other")  # bug|suggestion|question|other
    status: Mapped[str] = mapped_column(String(16), default="new")  # new|read|done
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
