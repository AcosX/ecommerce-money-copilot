FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app/backend
COPY requirements-runtime.txt ./
RUN pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple --no-cache-dir -r requirements-runtime.txt
COPY emc_api ./emc_api
COPY alembic ./alembic
COPY alembic.ini ./
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn emc_api.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*'"]
