# Thin Nextcloud ExApp: the core downloader runs in its own container.
FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm test && npm run build -- --mode nextcloud

FROM python:3.13-slim-trixie AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=9080 \
    PYTHONPATH=/app
RUN groupadd --system --gid 10001 exapp \
    && useradd --system --uid 10001 --gid exapp --home-dir /app exapp \
    && mkdir -p /app/nextcloud_exapp
WORKDIR /app
COPY nextcloud_exapp/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY nextcloud_exapp/*.py /app/nextcloud_exapp/
COPY --from=web-build /web/dist/ /app/nextcloud_exapp/dist/
USER exapp
EXPOSE 9080
# AppAPI performs authenticated /heartbeat probes; an unauthenticated Docker
# curl probe would incorrectly mark the secured ExApp unhealthy.
HEALTHCHECK NONE
CMD ["python", "-m", "nextcloud_exapp.main"]
