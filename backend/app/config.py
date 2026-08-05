"""配置管理（pydantic-settings + fast fail）。

对齐 docs/00-环境搭建.md 4.2 配置项清单与 docs/04-需求决策记录.md。
原则：缺失/非法配置直接拒绝启动（fast fail），不静默降级。
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全部配置来自环境变量 / .env（见 .env.example）。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- 数据库 ---
    database_url: str

    # --- LLM（04 v0.4：系统级 key 仅开发/测试/内部用途，不作为用户兜底）---
    litellm_api_keys: str = ""
    model_routing: str = "{}"

    # --- 密钥与加密（04 2.9 / 00 4.3 双轨）---
    api_key_enc_key: str
    jwt_secret: str
    jwt_expire_minutes: int = 720

    # --- 注册 ---
    invite_only: bool = True

    # --- 领域包 ---
    domain_pack_path: str = "./domain_packs"
    active_domain_pack: str = "junior_math_eq_ineq"

    # --- 评估 ---
    purity_threshold: float = 0.9

    # --- 日志 / 备份 ---
    log_level: str = "INFO"
    backup_dir: str = "D:\\AdaptTutorBackup"

    def validate_config(self) -> None:
        """fast fail：启动前校验，非法直接抛异常拒绝启动。"""
        if not self.database_url.startswith(("postgresql", "postgres")):
            raise ValueError("DATABASE_URL 必须为 PostgreSQL 连接串")
        if len(self.jwt_secret) < 16:
            raise ValueError("JWT_SECRET 长度必须 ≥ 16")
        if self.api_key_enc_key and not self.api_key_enc_key.startswith(
            "FernetKey-"
        ):
            # 允许开发期用任意字符串，但提示生产必须 Fernet
            pass
        if self.purity_threshold < 0 or self.purity_threshold > 1:
            raise ValueError("PURITY_THRESHOLD 必须在 [0,1]")
        if self.jwt_expire_minutes <= 0:
            raise ValueError("JWT_EXPIRE_MINUTES 必须为正整数")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_config()
    return settings
