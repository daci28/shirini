FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build

FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/data.json ./data.json
COPY --from=builder /app/settings.json ./settings.json

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
