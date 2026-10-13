import { supabase } from "../config/db.js";
import alerts from "../utils/alerts.js";
import { refundTariffListing } from "./subscriptionsService.js";

// Интервал запуска очистки — раз в 15 минут (Дефект 3.1)
export const MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;
export const STUCK_PAYMENT_THRESHOLD_MS = 10 * 60 * 1000; // 10 минут

let maintenanceTimer = null;

/**
 * Фоновая процедура периодической очистки:
 * 1. Помечает просроченные объявления (expires_at <= NOW() и status = 'active') в status = 'expired'.
 * 2. Сбрасывает просроченные промо-статусы (promotion_status = 'regular', is_urgent = false, priority_rank = 3),
 *    где promotion_expires_at <= NOW() или urgent_expires_at <= NOW().
 * 3. Проверяет зависшие подтверждённые платежи (status = 'approved' без fulfilled_at старше 10 минут) и шлёт алерт.
 */
export async function runMaintenanceJob() {
  const nowIso = new Date().toISOString();
  const summary = {
    expiredListingsCount: 0,
    resetPromotionsCount: 0,
    resetUrgentCount: 0,
    stuckPaymentsCount: 0,
  };

  try {
    // 0. Мониторинг зависших платежей: approved без fulfilled_at старше 10 минут
    try {
      const tenMinutesAgo = new Date(Date.now() - STUCK_PAYMENT_THRESHOLD_MS).toISOString();
      const { data: stuckPayments, error: stuckError } = await supabase
        .from("payments")
        .select("id, order_id, amount, status, created_at")
        .eq("status", "approved")
        .is("fulfilled_at", null)
        .lte("created_at", tenMinutesAgo);

      if (stuckError) {
        console.error("Cron Maintenance: error checking stuck approved payments:", stuckError);
      } else if (stuckPayments && stuckPayments.length > 0) {
        summary.stuckPaymentsCount = stuckPayments.length;
        await alerts.critical("Зависшие подтверждённые платежи без выдачи услуги (>10 мин)", {
          count: stuckPayments.length,
          paymentIds: stuckPayments.map((p) => p.id),
          orderIds: stuckPayments.map((p) => p.order_id),
        });
      }
    } catch (paymentCheckErr) {
      console.error("Cron Maintenance: payment check error (isolated):", paymentCheckErr?.message || paymentCheckErr);
    }

    // 1. Помечаем просроченные объявления: expires_at <= NOW() и status = 'active'
    const { data: expiredRows, error: expireError } = await supabase
      .from("listings")
      .update({
        status: "expired",
        updated_at: nowIso,
      })
      .eq("status", "active")
      .lte("expires_at", nowIso)
      .select("id, user_id");

    if (expireError) {
      console.error("Cron Maintenance: error expiring listings:", expireError);
    } else {
      summary.expiredListingsCount = expiredRows?.length || 0;
      if (expiredRows && expiredRows.length > 0) {
        for (const row of expiredRows) {
          if (row.user_id) {
            try {
              await refundTariffListing(row.user_id, `expire_${row.id}_${nowIso}`);
            } catch (refErr) {
              console.warn("Cron Maintenance: refundTariffListing error:", refErr?.message || refErr);
            }
          }
        }
      }
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
