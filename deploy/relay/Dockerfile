FROM oven/bun:1.3.9 AS app

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile
RUN bun run build:contracts
RUN bun run --cwd apps/web build

ENV NODE_ENV=production
ENV RELAY_HOST=0.0.0.0
ENV RELAY_PORT=8787
ENV RELAY_WEB_STATIC_DIR=/app/apps/web/dist

EXPOSE 8787

CMD ["bun", "run", "apps/relay/src/index.ts"]
