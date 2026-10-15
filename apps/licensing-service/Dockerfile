# Build from the monorepo root. Exact Node release keeps sqlite/runtime behavior reproducible.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/licensing/package.json packages/licensing/tsconfig.json ./packages/licensing/
COPY packages/licensing/src ./packages/licensing/src
COPY apps/licensing-service/package.json apps/licensing-service/tsconfig.json ./apps/licensing-service/
COPY apps/licensing-service/src ./apps/licensing-service/src
COPY apps/licensing-service/panel ./apps/licensing-service/panel
COPY apps/licensing-service/scripts ./apps/licensing-service/scripts
RUN pnpm install --ignore-scripts --frozen-lockfile
RUN pnpm --filter @gastronomy/licensing build && pnpm --filter @gastronomy/licensing-service build

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ENV NODE_ENV=production PORT=8097 HOST=0.0.0.0 DB_PATH=/data/licenses.sqlite
WORKDIR /app
RUN mkdir -p /data /app/node_modules/@gastronomy/licensing /app/apps/licensing-service \
    && chown -R node:node /data /app
COPY --from=build --chown=node:node /repo/packages/licensing/package.json /app/node_modules/@gastronomy/licensing/package.json
COPY --from=build --chown=node:node /repo/packages/licensing/dist /app/node_modules/@gastronomy/licensing/dist
COPY --from=build --chown=node:node /repo/apps/licensing-service/package.json /app/apps/licensing-service/package.json
COPY --from=build --chown=node:node /repo/apps/licensing-service/dist /app/apps/licensing-service/dist
USER node
EXPOSE 8097
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/licensing-service/dist/server.js"]
