"""领域包 schema（pydantic 校验）。

对齐 docs/03-项目架构.md 2.2 领域包结构与 04 决策（题目自创、图谱人工）。
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class PackManifest(BaseModel):
    """pack_manifest.json：id、版本、学科、依赖引擎版本。"""

    id: str = Field(pattern=r"^[a-z0-9_]+$")
    version: str
    subject: str
    engine_version: str = ">=0.1"


class GraphNode(BaseModel):
    """知识图谱节点。"""

    id: str
    name: str
    difficulty: float = Field(ge=0.0, le=1.0)
    importance: float = Field(ge=0.0, le=1.0)


class GraphEdge(BaseModel):
    """有向边：前置依赖（from 是 to 的前置）。"""

    from_: str = Field(alias="from")
    to: str
    type: Literal["prerequisite"] = "prerequisite"


class KnowledgeGraphSchema(BaseModel):
    """knowledge_graph.json。"""

    nodes: list[GraphNode]
    edges: list[GraphEdge]

    @field_validator("edges")
    @classmethod
    def _check_edge_refs(cls, v: list[GraphEdge], info) -> list[GraphEdge]:
        """边的端点必须存在于节点中（禁止悬空引用）。"""
        nodes = {n.id for n in info.data.get("nodes", [])}
        for e in v:
            if e.from_ not in nodes or e.to not in nodes:
                raise ValueError(f"edge {e.from_}->{e.to} 引用了不存在的节点")
        return v


class Question(BaseModel):
    """题目（四题型分级：choice|blank|open|multi，M4r24 新增多选）。"""

    id: str
    type: Literal["choice", "blank", "open", "multi"]
    content: str  # 题干（可含 KaTeX/LaTeX）
    tags: list[str] = Field(default_factory=list)
    difficulty: float = Field(ge=0.0, le=1.0)
    # 选择题选项（type=choice/multi 必填），answer 为正确选项索引或规范化答案
    # M4r24：multi 题 answer 为正确选项字母列表（如 ["A","C"]）
    options: list[str] | None = None
    answer: str | int | list[str]
    # 解题步骤 → 节点映射（错题溯源依据）
    step_node_map: dict[str, str] = Field(default_factory=dict)


class BktParams(BaseModel):
    """BKT 参数（文献常见默认，全部参数化，M5 用真实数据校准）。"""

    p_l0: float = 0.3   # P(L0) 初始掌握概率
    p_t: float = 0.05   # P(T) 学习概率
    p_g: float = 0.2    # P(G) 猜测概率
    p_s: float = 0.1    # P(S) 失误概率


class TerminationRule(BaseModel):
    """诊断终止条件（对齐 02 硬指标：根因置信度阈值 或 15 题上限）。"""

    confidence_threshold: float = Field(default=0.8, ge=0.0, le=1.0)
    max_questions: int = Field(default=15, ge=1)


class DiagnosticRules(BaseModel):
    """diagnostic_rules.json：初始选题策略、终止条件、BKT 参数。"""

    initial_strategy: str = "weakest_node"  # weakest_node | importance_first
    termination: TerminationRule = TerminationRule()
    bkt: BktParams = BktParams()


class AssessmentConfig(BaseModel):
    """assessment_config.json：引导纯度规则、掌握度阈值、回归测试集引用。"""

    purity_threshold: float = Field(default=0.9, ge=0.0, le=1.0)
    mastery_threshold: float = Field(default=0.85, ge=0.0, le=1.0)
    regression_suite: list[str] = Field(default_factory=list)


class DomainPack(BaseModel):
    """完整领域包（加载后聚合）。"""

    manifest: PackManifest
    graph: KnowledgeGraphSchema
    questions: list[Question]
    diagnostic_rules: DiagnosticRules
    assessment: AssessmentConfig
