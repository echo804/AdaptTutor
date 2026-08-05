"""pytest 全局配置：测试环境变量（NullPool 避免跨 loop 连接池冲突）。"""

import os

os.environ.setdefault("ADAPT_TEST_NULLPOOL", "1")
