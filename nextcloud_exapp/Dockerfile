# Thin Nextcloud ExApp: the core downloader runs in its own container.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm test && npm run build -- --mode nextcloud

FROM python:3.13-slim-trixie@sha256:09a17cad02668ae61ece136b4fd36ac3849e14f670ebedb637ea3e15580525bc AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=9080 \
    PYTHONPATH=/app
RUN groupadd --system --gid 10001 exapp \
    && useradd --system --uid 10001 --gid exapp --home-dir /app exapp \
    && mkdir -p /app/nextcloud_exapp /nc_app_downloader-server-nextcloud_data \
    && chown exapp:exapp /nc_app_downloader-server-nextcloud_data
WORKDIR /app
COPY nextcloud_exapp/requirements.lock /app/requirements.lock
COPY nextcloud_exapp/requirements.hashed.lock /app/requirements.hashed.lock
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /app/requirements.hashed.lock
# The Core job-state vocabulary is generated into the standalone ExApp's
# small Python leaf module at source review time and checked for parity in CI.
# Never copy any Core service source into this independently deployed image.
COPY nextcloud_exapp/*.py /app/nextcloud_exapp/
RUN python -c "from nextcloud_exapp.job_state_contract import TERMINAL_STATES; assert TERMINAL_STATES"
COPY --from=web-build /web/dist/ /app/nextcloud_exapp/dist/
USER exapp
EXPOSE 9080
# AppAPI performs authenticated /heartbeat probes; an unauthenticated Docker
# curl probe would incorrectly mark the secured ExApp unhealthy.
HEALTHCHECK NONE
CMD ["python", "-m", "nextcloud_exapp.main"]
