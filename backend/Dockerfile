# AdaptTutor 后端生产镜像（构建上下文 = 仓库根，见 docker-compose.prod.yml）
# 构建：docker build -f backend/Dockerfile -t adapttutor-api .
# 领域包持久化：compose 挂卷到 /app/domain_packs，首次启动由 entrypoint 从内置目录同步
FROM python:3.12-slim

WORKDIR /app

COPY backend/pyproject.toml .
COPY backend/app ./app
COPY backend/migrations ./migrations
COPY backend/alembic.ini .
# 内置领域包（只读基线；用户自建包写入挂载卷 /app/domain_packs）
COPY domain_packs ./domain_packs_builtin
COPY backend/docker-entrypoint.sh /usr/local/bin/adapt-entrypoint.sh
RUN chmod +x /usr/local/bin/adapt-entrypoint.sh \
    && pip install --no-cache-dir -e . \
    && rm -rf /root/.cache/pip

EXPOSE 8010
ENTRYPOINT ["adapt-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
