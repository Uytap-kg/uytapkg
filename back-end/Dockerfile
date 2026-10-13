# ============================================================================
# Multi-stage Dockerfile для UyTap Backend
# Базовый образ: node:20-alpine
# ============================================================================

# Шаг 1: Установка только production-зависимостей
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Шаг 2: Финальный образ для запуска
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000

# Копируем production зависимости и исходный код
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# Запуск от непривилегированного пользователя node
USER node

EXPOSE 5000

# Healthcheck проверяет доступность эндпоинта /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "src/index.js"]
