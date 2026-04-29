# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

WORKDIR /app

# Instala dependências em uma layer separada para aproveitar o cache do Docker.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copia apenas o que é necessário em runtime (estático + servidor).
COPY app.py index.html ./

# Executa como usuário não-root.
RUN useradd -m -u 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

# Cloud Run injeta $PORT (8080 por padrão). Workload é I/O-bound (chamadas
# Pipedrive), então 1 worker com threads basta — múltiplos workers em uma
# única instância de Cloud Run apenas competem pela mesma CPU.
CMD exec gunicorn --bind 0.0.0.0:${PORT} \
    --workers 1 \
    --threads 8 \
    --timeout 300 \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile - \
    app:app
