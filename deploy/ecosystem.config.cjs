/**
 * UyTap.kg — PM2 Production Configuration (deploy/ecosystem.config.cjs)
 *
 * Запуск:
 *   pm2 start deploy/ecosystem.config.cjs --env production
 *   pm2 save
 *
 * Особенности под нагрузкой:
 * - Backend работает в режиме cluster (2 инстанса по умолчанию, или max по CPU).
 *   Критичное состояние (OTP, лимиты, платежи, cron-lease) синхронизировано через PostgreSQL.
 * - kill_timeout = 30000 мс (30 с) согласован с таймаутом gracefulShutdown (25 с) в src/index.js,
 *   чтобы процесс успел сбросить буфер счётчиков просмотров/кликов и закрыть dbPool.
 * - max_memory_restart перезапускает воркер при превышении порога RSS без даунтайма (rolling reload).
 */

module.exports = {
  apps: [
    {
      name: "uytap-backend",
      cwd: "./back-end",
      script: "src/index.js",
      exec_mode: "cluster",
      instances: process.env.PM2_BACKEND_INSTANCES || 2,
      max_memory_restart: "512M",
      kill_timeout: 30000,
      wait_ready: false,
      listen_timeout: 10000,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      node_args: "--max-old-space-size=448",
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
        DB_POOL_MAX: 10,
        DB_POOL_IDLE_TIMEOUT_MS: 30000,
        DB_POOL_CONN_TIMEOUT_MS: 5000,
        DB_STATEMENT_TIMEOUT_MS: 15000,
      },
    },
    {
      name: "uytap-frontend",
      cwd: "./front-end",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      exec_mode: "cluster",
      instances: process.env.PM2_FRONTEND_INSTANCES || 2,
      max_memory_restart: "768M",
      kill_timeout: 15000,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      node_args: "--max-old-space-size=640",
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
