FROM node:22-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

# ---- dev stage ----
FROM base AS dev
COPY package.json pnpm-workspace.yaml ./
COPY services/users/package.json ./services/users/
RUN pnpm install
COPY . .
WORKDIR /app/services/users
CMD ["pnpm", "dev"]

# ---- build stage ----
# FROM base AS build
# COPY package.json pnpm-workspace.yaml ./
# COPY services/users/package.json ./services/users/
# RUN pnpm install --frozen-lockfile
# COPY . .
# RUN pnpm --filter users-service build

# ---- production stage ----
# FROM node:22-alpine AS prod
# WORKDIR /app
# COPY --from=build /app/services/users/dist ./dist
# COPY --from=build /app/services/users/package.json .
# RUN npm install --production
# CMD ["node", "dist/server.js"]
