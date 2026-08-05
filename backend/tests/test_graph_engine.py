"""图引擎测试：拓扑排序、环检测、路径规划、错题溯源。"""

import pytest

from app.domain.schemas import KnowledgeGraphSchema
from app.engine.graph_engine import KnowledgeGraph, plan_path, trace_root


def _graph() -> KnowledgeGraph:
    """k1(整数运算) → k2(一元一次方程)、k1 → k3(移项) → k4(解不等式)。"""
    schema = KnowledgeGraphSchema(
        nodes=[
            {"id": "k1", "name": "整数运算", "difficulty": 0.3, "importance": 0.9},
            {"id": "k2", "name": "一元一次方程", "difficulty": 0.5, "importance": 0.9},
            {"id": "k3", "name": "移项", "difficulty": 0.5, "importance": 0.8},
            {"id": "k4", "name": "解不等式", "difficulty": 0.7, "importance": 0.8},
        ],
        edges=[
            {"from": "k1", "to": "k2", "type": "prerequisite"},
            {"from": "k1", "to": "k3", "type": "prerequisite"},
            {"from": "k3", "to": "k4", "type": "prerequisite"},
        ],
    )
    return KnowledgeGraph(schema)


def test_topological_order_prerequisite_first():
    order = _graph().topological_order()
    assert order.index("k1") < order.index("k2")
    assert order.index("k1") < order.index("k3")
    assert order.index("k3") < order.index("k4")


def test_topological_cycle_detected():
    schema = KnowledgeGraphSchema(
        nodes=[
            {"id": "a", "name": "a", "difficulty": 0.5, "importance": 0.5},
            {"id": "b", "name": "b", "difficulty": 0.5, "importance": 0.5},
        ],
        edges=[
            {"from": "a", "to": "b", "type": "prerequisite"},
            {"from": "b", "to": "a", "type": "prerequisite"},
        ],
    )
    with pytest.raises(ValueError):
        KnowledgeGraph(schema).topological_order()


def test_plan_path_includes_prereq_chain():
    path = plan_path(_graph(), ["k4"])
    assert path[0] == "k1"  # 前置链起点
    assert set(path) == {"k1", "k3", "k4"}


def test_plan_path_respects_topology():
    path = plan_path(_graph(), ["k4"])
    order = {nid: i for i, nid in enumerate(path)}
    assert order["k1"] < order["k3"] < order["k4"]


def test_trace_root_lowest_mastery():
    kg = _graph()
    root = trace_root(kg, "k4", {"k1": 0.1, "k3": 0.9})
    assert root == "k1"  # k1 掌握度最低 → 根因


def test_trace_root_unlearned_prereq():
    kg = _graph()
    # k3 未学（未记录 → 0），k1 已掌握 → 根因应为 k3
    root = trace_root(kg, "k4", {"k1": 0.9})
    assert root == "k3"


def test_trace_root_no_prereq_returns_self():
    kg = KnowledgeGraph(
        KnowledgeGraphSchema(
            nodes=[
                {"id": "a", "name": "a", "difficulty": 0.5, "importance": 0.5}
            ],
            edges=[],
        )
    )
    assert trace_root(kg, "a", {}) == "a"
