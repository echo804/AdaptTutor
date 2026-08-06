"""生成生产密钥并写出 backend/.env.production（从 .env.production.example 模板）。

用法：
    python scripts/gen_prod_secrets.py [--force]

- 生成 API_KEY_ENC_KEY（Fernet 128 位）与 JWT_SECRET（64 hex）
- 已有 .env.production 时默认不覆盖（--force 覆盖），只补缺失的空密钥
"""
from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

from cryptography.fernet import Fernet

BACKEND = Path(__file__).resolve().parent.parent
TEMPLATE = BACKEND / ".env.production.example"
TARGET = BACKEND / ".env.production"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="覆盖已有 .env.production")
    args = ap.parse_args()

    if not TEMPLATE.is_file():
        print(f"缺少模板: {TEMPLATE}")
        return 1

    existing = TARGET.read_text(encoding="utf-8") if TARGET.is_file() else ""
    if existing and not args.force:
        # 只补缺失的空密钥字段
        lines = []
        for line in TEMPLATE.read_text(encoding="utf-8").splitlines():
            key = line.split("=", 1)[0].strip()
            if not key or key.startswith("#"):
                continue
            if key in ("API_KEY_ENC_KEY", "JWT_SECRET"):
                cur = next((l.split("=", 1)[1].strip() for l in existing.splitlines() if l.startswith(f"{key}=") and l.split("=", 1)[1].strip()), "")
                if cur:
                    continue
            lines.append(line)
        if not lines:
            print(".env.production 已存在且密钥齐全，未改动。")
            return 0
        print("补充缺失密钥到现有 .env.production …")

    enc = Fernet.generate_key().decode()
    jwt = secrets.token_hex(32)
    out_lines = []
    for line in TEMPLATE.read_text(encoding="utf-8").splitlines():
        if line.startswith("API_KEY_ENC_KEY="):
            out_lines.append(f"API_KEY_ENC_KEY={enc}")
        elif line.startswith("JWT_SECRET="):
            out_lines.append(f"JWT_SECRET={jwt}")
        else:
            out_lines.append(line)
    TARGET.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    print(f"已生成 {TARGET}")
    print("请手动确认 LITELLM_API_KEYS / MODEL_ROUTING（如需系统级 LLM key）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
