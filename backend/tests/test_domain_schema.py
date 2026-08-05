"""领域包 schema 校验测试。"""

import pytest
from pydantic import ValidationError

from app.domain.schemas import (
    BktParams,
    DiagnosticRules,
    KnowledgeGraphSchema,
    PackManifest,
)


def _node(nid: str) -> dict:
    return {"id": nid, "name": nid, "difficulty": 0.5, "importance": 0.6}


def test_manifest_id_format():
    PackManifest(id="junior_math_eq_ineq", version="1.0.0", subject="初中数学")
    with pytest.raises(ValidationError):
        PackManifest(id="Bad Id!", version="1.0.0", subject="x")


def test_graph_valid():
    kg = KnowledgeGraphSchema(
        nodes=[_node("a"), _node("b")],
        edges=[{"from": "a", "to": "b", "type": "prerequisite"}],
    )
    assert len(kg.nodes) == 2


def test_graph_dangling_edge_rejected():
    with pytest.raises(ValidationError):
        KnowledgeGraphSchema(
            nodes=[_node("a")],
            edges=[{"from": "a", "to": "b", "type": "prerequisite"}],
        )


def test_difficulty_range():
    with pytest.raises(ValidationError):
        KnowledgeGraphSchema(nodes=[_node("a") | {"difficulty": 1.5}], edges=[])


def test_bkt_defaults():
    rules = DiagnosticRules()
    assert rules.bkt == BktParams(p_l0=0.3, p_t=0.05, p_g=0.2, p_s=0.1)
    assert rules.termination.max_questions == 15
