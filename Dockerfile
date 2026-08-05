FROM node:22.16.0-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build

RUN npm ci --omit=dev


FROM node:22.16.0-slim AS runtime

RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --create-home appuser

WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/dist dist/
COPY --from=builder /app/package.json package.json
COPY src/platform/db/migrations dist/platform/db/migrations/

USER appuser

EXPOSE 3000

CMD ["node", "dist/main.js"]
