"""领域包加载器：schema 校验 + 运行时导入（启动全量内存加载，04 1.6）。

对齐 docs/03-项目架构.md 2.2 领域包目录结构与架构纪律（repository 可替换）。
"""

import json
from functools import lru_cache
from pathlib import Path

from app.config import get_settings
from app.domain.schemas import (
    AssessmentConfig,
    DiagnosticRules,
    DomainPack,
    KnowledgeGraphSchema,
    PackManifest,
    Question,
)

PACK_FILES = {
    "manifest": "pack_manifest.json",
    "graph": "knowledge_graph.json",
    "questions": "questions.json",
    "diagnostic_rules": "diagnostic_rules.json",
    "assessment": "assessment_config.json",
}


def _load_json(path: Path) -> dict | list:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_pack(pack_id: str, base_dir: str | None = None) -> DomainPack:
    """加载并校验领域包；校验失败抛异常（fast fail）。"""
    root = Path(base_dir or get_settings().domain_pack_path)
    pack_dir = root / pack_id
    if not pack_dir.is_dir():
        raise FileNotFoundError(f"领域包目录不存在: {pack_dir}")

    manifest = PackManifest.model_validate(
        _load_json(pack_dir / PACK_FILES["manifest"])
    )
    if manifest.id != pack_id:
        raise ValueError(
            f"manifest.id ({manifest.id}) 与目录名 ({pack_id}) 不一致"
        )

    graph = KnowledgeGraphSchema.model_validate(
        _load_json(pack_dir / PACK_FILES["graph"])
    )
    questions = [
        Question.model_validate(q)
        for q in _load_json(pack_dir / PACK_FILES["questions"])
    ]
    diagnostic_rules = DiagnosticRules.model_validate(
        _load_json(pack_dir / PACK_FILES["diagnostic_rules"])
    )
    assessment = AssessmentConfig.model_validate(
        _load_json(pack_dir / PACK_FILES["assessment"])
    )

    return DomainPack(
        manifest=manifest,
        graph=graph,
        questions=questions,
        diagnostic_rules=diagnostic_rules,
        assessment=assessment,
    )


@lru_cache
def get_active_pack() -> DomainPack:
    """启动全量内存加载当前激活领域包（04 1.6：图谱不可变 + 版本号）。"""
    return load_pack(get_settings().active_domain_pack)
