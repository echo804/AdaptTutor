"""图引擎：拓扑+权重路径规划 / 错题溯源（依赖链回溯）。

对齐 docs/03-项目架构.md 2.1 与 04 1.6（图谱启动全量内存加载，应用层算法，非图数据库）。
"""

from __future__ import annotations

from collections import defaultdict, deque

from app.domain.schemas import KnowledgeGraphSchema


class KnowledgeGraph:
    """内存图谱：节点索引 + 前置/后继邻接表。"""

    def __init__(self, graph: KnowledgeGraphSchema):
        self.nodes = {n.id: n for n in graph.nodes}
        # prereq[child] = [父节点]；succ[parent] = [子节点]
        self.prereq: dict[str, list[str]] = defaultdict(list)
        self.succ: dict[str, list[str]] = defaultdict(list)
        for e in graph.edges:
            self.prereq[e.to].append(e.from_)
            self.succ[e.from_].append(e.to)

    @property
    def node_ids(self) -> list[str]:
        return list(self.nodes)

    def topological_order(self) -> list[str]:
        """Kahn 拓扑排序（前置先于后置）；有环则抛 ValueError。"""
        indeg = {nid: len(self.prereq[nid]) for nid in self.nodes}
        queue = deque(nid for nid, d in indeg.items() if d == 0)
        order: list[str] = []
        while queue:
            nid = queue.popleft()
            order.append(nid)
            for child in self.succ[nid]:
                indeg[child] -= 1
                if indeg[child] == 0:
                    queue.append(child)
        if len(order) != len(self.nodes):
            raise ValueError("知识图谱存在环，无法拓扑排序")
        return order

    def ancestors(self, node_id: str) -> set[str]:
        """全部前置祖先（含间接依赖链）。"""
        seen: set[str] = set()
        stack = list(self.prereq.get(node_id, []))
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(self.prereq.get(cur, []))
        return seen


def plan_path(
    graph: KnowledgeGraph, weak_nodes: list[str], max_len: int = 10
) -> list[str]:
    """路径规划：拓扑序 + 权重（重要度降序）。

    取薄弱节点及其全部前置祖先，按拓扑序约束 + 重要度优先返回推荐学习序列。
    """
    candidates: set[str] = set(weak_nodes)
    for w in weak_nodes:
        candidates |= graph.ancestors(w)

    topo_index = {nid: i for i, nid in enumerate(graph.topological_order())}
    ranked = sorted(
        candidates,
        key=lambda nid: (
            topo_index[nid],
            -graph.nodes[nid].importance,
            graph.nodes[nid].difficulty,
        ),
    )
    return ranked[:max_len]


def trace_root(
    graph: KnowledgeGraph, wrong_node: str, mastery_p: dict[str, float]
) -> str:
    """错题溯源：沿前置依赖链回溯，返回掌握度最低（最可能的根因）节点。

    mastery_p 为 {node_id: 掌握概率}；未记录的按 0（未学）处理。
    """
    chain = graph.ancestors(wrong_node)
    if not chain:
        return wrong_node
    return min(chain, key=lambda nid: mastery_p.get(nid, 0.0))


def trace_root_evidenced(
    graph: KnowledgeGraph,
    wrong_node: str,
    mastery_p: dict[str, float],
    answered: set[str] | None = None,
) -> str:
    """错题溯源（M3 精细化，对齐 02 M3"步骤→节点映射 + 依赖链回溯"）。

    仅凭**已探测（作答过）**的证据判根因：
    1. 沿依赖链收集祖先；2. 在已探测祖先中选掌握度最低者；
    3. 无已探测祖先 → 保守返回错题节点本身（未测节点不可断言为根因）。

    修复 M2 观察到的缺陷：多个未测节点掌握度相同（默认 P(L0)）时
    原 trace_root 随机选中，根因判定不可靠。
    """
    answered = answered or set()
    chain = graph.ancestors(wrong_node)
    if not chain:
        return wrong_node
    evidenced = [nid for nid in chain if nid in answered]
    if not evidenced:
        return wrong_node
    return min(evidenced, key=lambda nid: mastery_p.get(nid, 0.0))
