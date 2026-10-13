import { supabase } from "../config/db.js";

// Интервал запуска очистки — раз в 15 минут (Дефект 3.1)
export const MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;

let maintenanceTimer = null;

/**
 * Фоновая процедура периодической очистки:
 * 1. Помечает просроченные объявления (expires_at <= NOW() и status = 'active') в status = 'expired'.
 * 2. Сбрасывает просроченные промо-статусы (promotion_status = 'regular', is_urgent = false, priority_rank = 3),
 *    где promotion_expires_at <= NOW() или urgent_expires_at <= NOW().
 */
export async function runMaintenanceJob() {
  const nowIso = new Date().toISOString();
  const summary = {
    expiredListingsCount: 0,
    resetPromotionsCount: 0,
    resetUrgentCount: 0,
  };

  try {
    // 1. Помечаем просроченные объявления: expires_at <= NOW() и status = 'active'
    const { data: expiredRows, error: expireError } = await supabase
      .from("listings")
      .update({
        status: "expired",
        updated_at: nowIso,
      })
      .eq("status", "active")
      .lte("expires_at", nowIso)
      .select("id");

    if (expireError) {
      console.error("Cron Maintenance: error expiring listings:", expireError);
    } else {
      summary.expiredListingsCount = expiredRows?.length || 0;
    }

    // 2. Сбрасываем просроченные промо-статусы promotion_status (vip / top)
    const { data: promoRows, error: promoError } = await supabase
      .from("listings")
      .update({
        promotion_status: "regular",
        priority_rank: 3,
        updated_at: nowIso,
      })
      .neq("promotion_status", "regular")
      .lte("promotion_expires_at", nowIso)
      .select("id");

    if (promoError) {
      console.error("Cron Maintenance: error resetting promotions:", promoError);
    } else {
      summary.resetPromotionsCount = promoRows?.length || 0;
    }

    // 3. Сбрасываем просроченные срочные статусы is_urgent
    const { data: urgentRows, error: urgentError } = await supabase
      .from("listings")
      .update({
        is_urgent: false,
        priority_rank: 3,
        updated_at: nowIso,
      })
      .eq("is_urgent", true)
      .lte("urgent_expires_at", nowIso)
      .select("id");

    if (urgentError) {
      console.error("Cron Maintenance: error resetting urgent flags:", urgentError);
    } else {
      summary.resetUrgentCount = urgentRows?.length || 0;
    }
  } catch (error) {
    console.error("Cron Maintenance: unhandled error in runMaintenanceJob:", error);
  }

  return summary;
}

/**
 * Запуск фонового планировщика.
 * Таймер вызывает .unref(), чтобы фоновый интервал не блокировал завершение тестов Node.js.
 */
export function startCronService(intervalMs = MAINTENANCE_INTERVAL_MS) {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
  }

  maintenanceTimer = setInterval(async () => {
    try {
      await runMaintenanceJob();
    } catch (err) {
      console.error("Cron interval execution error:", err);
    }
  }, intervalMs);

  if (maintenanceTimer && typeof maintenanceTimer.unref === "function") {
    maintenanceTimer.unref();
  }

  return maintenanceTimer;
}

/**
 * Остановка планировщика (для чистоты завершения процессов и тестов)
 */
export function stopCronService() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}
