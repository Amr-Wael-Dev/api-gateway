FROM node:18-alpine

WORKDIR /app/gateway

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install

COPY . .

RUN pnpm build

CMD ["node", "dist/index.js"]
