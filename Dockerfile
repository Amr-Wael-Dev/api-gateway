FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- dev stage ----
FROM base AS dev
ARG SERVICE_PATH
COPY package.json pnpm-workspace.yaml ./
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/
COPY shared/errors/package.json ./shared/errors/
COPY shared/logger/package.json ./shared/logger/
COPY shared/middleware/package.json ./shared/middleware/
COPY shared/types/package.json ./shared/types/
RUN pnpm install
COPY . .
WORKDIR /app/${SERVICE_PATH}
CMD ["pnpm", "dev"]

# ---- build stage ----
FROM base AS build
ARG SERVICE_PATH
COPY package.json pnpm-workspace.yaml ./
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/
COPY shared/errors/package.json ./shared/errors/
COPY shared/logger/package.json ./shared/logger/
COPY shared/middleware/package.json ./shared/middleware/
COPY shared/types/package.json ./shared/types/
RUN pnpm install
COPY . .
WORKDIR /app/${SERVICE_PATH}
RUN pnpm build

# ---- production stage ----
FROM node:22-alpine AS prod
ARG SERVICE_PATH
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY --from=build /app/${SERVICE_PATH}/dist ./dist
COPY --from=build /app/${SERVICE_PATH}/package.json ./
RUN pnpm install --prod
CMD ["node", "dist/server.js"]
