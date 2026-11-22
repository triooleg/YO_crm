FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/database packages/database
RUN pnpm --filter @yoleotard-crm/database build && pnpm --filter @yoleotard-crm/api build
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app ./
COPY --from=build /root/.cache/node/corepack /root/.cache/node/corepack
CMD ["pnpm","--filter","@yoleotard-crm/api","start"]
