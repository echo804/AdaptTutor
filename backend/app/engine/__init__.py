"""引擎层（领域无关核心）。

M1b 起实现：state_machine / diagnostic / graph_engine / scheduler / evaluator / llm_gateway。
架构纪律：本层不 import FastAPI / SQLAlchemy 具体实现（依赖反转）。
"""
