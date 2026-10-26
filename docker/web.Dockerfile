FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile=false
COPY apps/web apps/web
COPY apps/api/src/overview/sales-statistics.types.ts apps/api/src/overview/sales-statistics.types.ts
ARG NEXT_PUBLIC_API_BASE_URL
ARG CRM_COMMIT
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV CRM_COMMIT=$CRM_COMMIT
RUN pnpm --filter @yoleotard-crm/web build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public /app/apps/web/public
ENV PORT=3500
ENV HOSTNAME=0.0.0.0
EXPOSE 3500
CMD ["node","apps/web/server.js"]
