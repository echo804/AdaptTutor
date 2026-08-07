"""M6.1 安全：上传大小限制 + 压缩炸弹检测测试（纯函数级，不触发 LLM）。"""

import io
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from app.api.routes_user_domains import (
    MAX_EXTRACT_TOTAL,
    MAX_UPLOAD_BYTES,
    _safe_extract_zip,
    _save_uploads,
)


async def test_upload_file_too_large(monkeypatch):
    monkeypatch.setattr("app.api.routes_user_domains.MAX_UPLOAD_BYTES", 10)
    f = UploadFile(filename="a.md", file=io.BytesIO(b"x" * 100))
    with pytest.raises(HTTPException) as e:
        await _save_uploads(domain_id=999001, files=[f], zip_file=None, text=None)
    assert e.value.status_code == 413
    assert "过大" in e.value.detail


async def test_upload_zip_too_large(monkeypatch):
    monkeypatch.setattr("app.api.routes_user_domains.MAX_UPLOAD_BYTES", 10)
    zf = UploadFile(filename="bundle.zip", file=io.BytesIO(b"PK\x03\x04" + b"x" * 100))
    with pytest.raises(HTTPException) as e:
        await _save_uploads(domain_id=999002, files=None, zip_file=zf, text=None)
    assert e.value.status_code == 413


def test_extract_zip_bomb_rejected(monkeypatch, tmp_path):
    # 压缩炸弹：解压后总大小超过上限（monkeypatch 缩小上限便于构造）
    monkeypatch.setattr("app.api.routes_user_domains.MAX_EXTRACT_TOTAL", 10)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "hello world this is bigger than 10 bytes")
    buf.seek(0)
    with zipfile.ZipFile(buf) as z:
        with pytest.raises(HTTPException) as e:
            _safe_extract_zip(z, Path(tmp_path))
    assert e.value.status_code == 413
    assert "解压后内容过大" in e.value.detail


def test_extract_zip_normal_ok(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("general/b.md", "small")
    buf.seek(0)
    with zipfile.ZipFile(buf) as z:
        _safe_extract_zip(z, Path(tmp_path))
    assert (Path(tmp_path) / "general" / "b.md").read_text() == "small"
