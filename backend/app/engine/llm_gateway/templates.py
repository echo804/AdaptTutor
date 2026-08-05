"""模板话术库（降级 L2 / 离线 L3 / mock 模式共用）。

对齐 04 1.6 三层降级：切备用模型 → 模板话术 → 离线提示。
模板话术是"确定性兜底"——不依赖 LLM 也能给出可用的引导/占位内容。
"""

from __future__ import annotations

OFFLINE_PROMPT = "（当前模型服务不可用，请稍后重试，或检查 API key 配置。）"

# 各角色降级话术模板（{var} 由编排层填充，此处给默认占位）
_TEMPLATES: dict[str, str] = {
    "diagnostic": "我们先做一道题热身：{question}（降级模式：请直接作答，我会根据结果继续。）",
    "tutor": "再想一想：{hint}（降级模式：提示暂由规则模板生成。）",
    "generate": "请练习这一题：{question}（降级模式：题目暂由领域包题库提供。）",
    "review": "小结：{summary}（降级模式：复习要点暂由规则生成。）",
}

# 确定性兜底（不依赖领域包数据，纯静态）
_FALLBACK: dict[str, str] = {
    "diagnostic": "我们开始诊断吧：先做一道关于当前知识点的题目，你只管作答。",
    "tutor": "再看一步：注意这一步的依据是什么？能不能先说出来？",
    "generate": "请完成这道练习题，写出你的思路。",
    "review": "我们回顾一下：这个知识点你刚才练习过，试着复述一下关键步骤。",
}


def by_role(role: str, **kwargs) -> str:
    """按角色取模板话术（kwargs 填充 {var}）。"""
    tpl = _TEMPLATES.get(role) or _FALLBACK.get(role, _FALLBACK["tutor"])
    try:
        return tpl.format(**kwargs) if kwargs else tpl
    except (KeyError, IndexError):
        return tpl


def fallback_for(role: str) -> str:
    """确定性兜底话术（模板参数缺失时用）。"""
    return _FALLBACK.get(role, _FALLBACK["tutor"])
