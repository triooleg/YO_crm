FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile=false
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN pnpm --filter @yoleotard-crm/web build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
ENV PORT=3500
ENV HOSTNAME=0.0.0.0
EXPOSE 3500
CMD ["node","apps/web/server.js"]
