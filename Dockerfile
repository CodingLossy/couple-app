FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --create-home --home-dir /home/app app

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
RUN chmod +x deploy/docker-entrypoint.sh \
  && mkdir -p /data /backups \
  && chown -R app:app /app /data /backups

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    TRUST_PROXY=1 \
    NODE_OPTIONS=--max-old-space-size=256

EXPOSE 8787
VOLUME ["/data", "/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/deploy/docker-entrypoint.sh"]
