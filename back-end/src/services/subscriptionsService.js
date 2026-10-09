import { supabase } from "../config/db.js";
import { getPricingSettings } from "../utils/pricingSettings.js";
import {
  calculateProRata,
  getTariffDailyPrice,
  DAYS_IN_MONTH,
} from "../constants/tariffs.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Без активного тарифа личным продавцам разрешено бесплатно держать
// ограниченное число активных объявлений (см. фронтенд /pricing — план
// "Частный"); риэлторам/агентствам/застройщикам без тарифа/индивидуальной
// выдачи — 0, публикация объявления требует оплаченного тарифа.
const FREE_PERSONAL_ACTIVE_LISTINGS = 2;

// Активирует/продлевает тариф пользователя после подтверждённой оплаты.
//
// 1. Pro-Rata перерасчёт:
//    - Если продлевается ТОТ ЖЕ тариф: к текущей дате expires_at прибавляется months * 30 дней.
//    - Если тариф ДРУГОЙ: остаточная стоимость пересчитывается в дни нового тарифа,
//      и итоговый срок = NOW() + (convertedDays + months * 30 дней).
//
// 2. Защита индивидуальной подписки:
//    - Если активна подписка с is_individual === true и срок не истёк,
//      покупка дефолтного тарифа отклоняется с ошибкой 409 Conflict.
//
// 3. Атомарность и идемпотентность:
//    - Принимает опциональный paymentId.
//    - Исключает повторное продление по одному и тому же paymentId.
//    - Применяет Postgres-функцию activate_subscription_atomic с FOR UPDATE блокировкой.
export async function activateSubscription(userId, tariffId, months, paymentId = null) {
  // 1. Проверяем наличие уже существующей подписки
  const { data: existing, error: fetchError } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError) {
    console.error("Activate Subscription Fetch Error:", fetchError);
    throw new Error("Не удалось получить текущую подписку");
  }

  const now = Date.now();
  const currentExpiry = existing?.expires_at ? new Date(existing.expires_at).getTime() : 0;
  const isCurrentActive = Boolean(existing?.is_active) && currentExpiry > now;

  // 2. Защита индивидуальной подписки:
  // Если у пользователя активна подписка с is_individual === true (и срок не истёк):
  // покупка дефолтного тарифа без подтверждения отклоняется с ошибкой 409 Conflict.
  if (isCurrentActive && existing.is_individual) {
    const conflictError = new Error(
      "У вас активен персональный корпоративный тариф. Для смены тарифа обратитесь к администратору"
    );
    conflictError.status = 409;
    conflictError.statusCode = 409;
    conflictError.code = "INDIVIDUAL_TARIFF_ACTIVE";
    throw conflictError;
  }

  // 3. Атомарность и идемпотентность:
  // Защищать от повторной активации одного и того же paymentId
  if (paymentId) {
    const { data: alreadyProcessed, error: procErr } = await supabase
      .from("processed_subscription_payments")
      .select("payment_id")
      .eq("payment_id", paymentId)
      .maybeSingle();

    if (!procErr && alreadyProcessed) {
      return {
        tariffId: existing?.tariff_id || tariffId,
        expiresAt: existing?.expires_at || new Date().toISOString(),
        alreadyProcessed: true,
      };
    }
  }

  // 4. Расчёт дней по бизнес-правилу Pro-Rata при смене тарифа
  const pricing = await getPricingSettings();
  const periodMonths = Number(months) || 1;
  let targetExpiresAt;
  let daysForRpc;

  if (isCurrentActive) {
    if (existing.tariff_id === tariffId) {
      // Тот же тариф: просто продлеваем текущий срок
      targetExpiresAt = new Date(currentExpiry + periodMonths * DAYS_IN_MONTH * DAY_MS).toISOString();
      daysForRpc = periodMonths * DAYS_IN_MONTH;
    } else {
      // Другой тариф: Pro-Rata перерасчёт
      const proRata = calculateProRata({
        currentTariffId: existing.tariff_id,
        newTariffId: tariffId,
        currentExpiresAt: existing.expires_at,
        newMonths: periodMonths,
        pricing,
        nowMs: now,
      });
      targetExpiresAt = proRata.expiresAt.toISOString();
      daysForRpc = proRata.totalDays;
    }
  } else {
    // Нет активной подписки: отсчёт от текущего момента
    targetExpiresAt = new Date(now + periodMonths * DAYS_IN_MONTH * DAY_MS).toISOString();
    daysForRpc = periodMonths * DAYS_IN_MONTH;
  }

  // 5. Атомарная активация через Postgres-функцию activate_subscription_atomic
  let rpcSuccess = false;
  let activatedSub = null;

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "activate_subscription_atomic",
      {
        p_user_id: userId,
        p_tariff_id: tariffId,
        p_days: daysForRpc,
        p_payment_id: paymentId || null,
      }
    );

    if (!rpcError && rpcData) {
      rpcSuccess = true;
      activatedSub = rpcData;
    } else if (rpcError) {
      if (rpcError.message?.includes("персональный корпоративный тариф")) {
        const conflictError = new Error(
          "У вас активен персональный корпоративный тариф. Для смены тарифа обратитесь к администратору"
        );
        conflictError.status = 409;
        conflictError.statusCode = 409;
        conflictError.code = "INDIVIDUAL_TARIFF_ACTIVE";
        throw conflictError;
      }
      console.warn(
        "⚠️ activate_subscription_atomic RPC failed or not installed, falling back to direct query:",
        rpcError.message || rpcError
      );
    }
  } catch (err) {
    if (err.status === 409 || err.statusCode === 409) {
      throw err;
    }
    console.warn("⚠️ activate_subscription_atomic RPC exception, fallback:", err.message);
  }

  // 6. Фолбэк на прямой upsert (если RPC ещё не развёрнут в БД)
  if (!rpcSuccess) {
    const { data: updatedSub, error: upsertError } = await supabase
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          tariff_id: tariffId,
          expires_at: targetExpiresAt,
          started_at: existing?.started_at || new Date().toISOString(),
          is_active: true,
          is_individual: false,
          custom_name: null,
          active_listings_limit: null,
          vip_boosts_limit: null,
          top_boosts_limit: null,
          listings_used: 0,
          vip_boosts_used: 0,
          top_boosts_used: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .maybeSingle();

    if (upsertError) {
      console.error("Activate Subscription Error:", upsertError);
      throw new Error("Не удалось активировать тариф");
    }

    if (paymentId) {
      const { error: procInsertErr } = await supabase
        .from("processed_subscription_payments")
        .insert({
          payment_id: paymentId,
          user_id: userId,
          tariff_id: tariffId,
        });

      if (procInsertErr && procInsertErr.code !== "23505") {
        console.warn("processed_subscription_payments insert warning:", procInsertErr);
      }
    }

    activatedSub = updatedSub || { tariff_id: tariffId, expires_at: targetExpiresAt };
  }

  const finalExpiresAt = activatedSub?.expires_at || targetExpiresAt;
  return {
    tariffId,
    expiresAt: finalExpiresAt,
  };
}

// Возвращает подписку пользователя, только если она реально действует
// прямо сейчас (включена админом и срок не истёк) — иначе null. Используется
// везде, где нужно понять "положены ли этому пользователю бесплатные
// поднятия VIP/TOP по тарифу".
export async function getActiveSubscription(userId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Get Active Subscription Error:", error);
    return null;
  }

  if (!data || !data.is_active) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  return data;
}

// Лимиты VIP/TOP поднятий, положенные по тарифу пользователя:
//   - индивидуальный тариф — собственные vip_boosts_limit/top_boosts_limit;
//   - дефолтный тариф (start/optimal/business) — из текущих настроек цен
//     (см. utils/pricingSettings.js), т.к. лимиты дефолтных тарифов общие
//     для всех и не хранятся в каждой строке подписки.
export async function getTariffBoostLimits(subscription) {
  if (!subscription) return { vip: 0, top: 0 };

  if (subscription.is_individual) {
    return {
      vip: subscription.vip_boosts_limit ?? 0,
      top: subscription.top_boosts_limit ?? 0,
    };
  }

  const pricing = await getPricingSettings();
  const plan = pricing.tariffs[subscription.tariff_id];

  if (!plan) return { vip: 0, top: 0 };

  return { vip: plan.vipLifts ?? 0, top: plan.topLifts ?? 0 };
}

// Сколько активных объявлений (status="active") разрешено пользователю
// одновременно прямо сейчас: по активному тарифу (индивидуальному или
// дефолтному — из текущих настроек цен), либо бесплатный лимит без
// тарифа (см. FREE_PERSONAL_ACTIVE_LISTINGS выше). Используется при
// создании объявления и при возврате объявления в статус "active" (см.
// controllers/listingsController.js), чтобы лимит тарифа нельзя было
// обойти скрытием/показом объявлений вместо реального удаления.
export async function getActiveListingsLimit(userId, accountType) {
  const subscription = await getActiveSubscription(userId);

  if (subscription) {
    if (subscription.is_individual) {
      return subscription.active_listings_limit ?? 0;
    }

    const pricing = await getPricingSettings();
    const plan = pricing.tariffs[subscription.tariff_id];
    return plan?.activeListings ?? 0;
  }

  let resolvedType = accountType;
  if (!resolvedType) {
    const { data: userRow } = await supabase
      .from("users")
      .select("account_type")
      .eq("id", userId)
      .maybeSingle();
    resolvedType = userRow?.account_type || "personal";
  }

  return resolvedType === "personal" ? FREE_PERSONAL_ACTIVE_LISTINGS : 0;
}

// Пытается списать одно бесплатное поднятие (VIP или TOP) с тарифа
// пользователя. Возвращает { granted: true, remaining } при успехе, либо
// { granted: false, reason } если тарифа нет/лимит исчерпан — в этом
// случае вызывающий код должен направить пользователя на обычную платную
// покупку продвижения (см. controllers/listingsController.js
// promoteListingWithTariff).
//
// boostType: "vip" | "top"
export async function consumeTariffBoost(userId, boostType) {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    return { granted: false, reason: "no_active_tariff" };
  }

  const limits = await getTariffBoostLimits(subscription);
  const limit = boostType === "vip" ? limits.vip : limits.top;
  const usedField = boostType === "vip" ? "vip_boosts_used" : "top_boosts_used";
  const used = subscription[usedField] || 0;

  if (used >= limit) {
    return { granted: false, reason: "limit_reached" };
  }

  // Условие .eq(usedField, used) — оптимистическая блокировка: если между
  // чтением и записью счётчик уже кем-то изменился (двойной клик,
  // параллельный запрос), update не найдёт строку и ничего не спишет,
  // вместо того чтобы дать использовать одно и то же поднятие дважды.
  const { data: updated, error } = await supabase
    .from("subscriptions")
    .update({ [usedField]: used + 1, updated_at: new Date().toISOString() })
    .eq("id", subscription.id)
    .eq(usedField, used)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Consume Tariff Boost Error:", error);
    return { granted: false, reason: "error" };
  }

  if (!updated) {
    return { granted: false, reason: "conflict" };
  }

  return { granted: true, remaining: limit - (used + 1) };
}

// Возвращает одно поднятие, ранее списанное consumeTariffBoost, когда
// действие, ради которого оно списывалось, в итоге не состоялось (см.
// controllers/listingsController.js createListing — объявление не
// создалось или продвижение не удалось применить после списания).
// Атомарно уменьшает счётчик через Postgres RPC с защитой от гонок и повторов (operationId).
export async function refundTariffBoost(userId, boostType, operationId = null) {
  if (!userId || !boostType) return;

  // 1. Попытка атомарного возврата через Postgres RPC с защитой от гонок и идемпотентностью
  try {
    const { error } = await supabase.rpc("refund_tariff_boost_atomic", {
      p_user_id: userId,
      p_boost_type: boostType,
      p_operation_id: operationId || null,
    });

    if (!error) {
      return;
    }
    console.warn("⚠️ refund_tariff_boost_atomic RPC failed, falling back:", error.message || error);
  } catch (err) {
    console.warn("⚠️ refund_tariff_boost_atomic RPC exception:", err.message);
  }

  // 2. Идемпотентность в фолбэке
  if (operationId) {
    try {
      const { data: alreadyProcessed } = await supabase
        .from("processed_refund_operations")
        .select("operation_id")
        .eq("operation_id", operationId)
        .maybeSingle();

      if (alreadyProcessed) {
        return;
      }
    } catch {
      // Игнорируем ошибку чтения processed_refund_operations при отсутствии таблицы в моках
    }
  }

  const subscription = await getActiveSubscription(userId);
  if (!subscription) return;

  const usedField = boostType === "vip" ? "vip_boosts_used" : "top_boosts_used";
  const used = subscription[usedField] || 0;
  if (used <= 0) return;

  // Оптимистическая блокировка для защиты от гонок read-modify-write
  const { data: updated, error } = await supabase
    .from("subscriptions")
    .update({ [usedField]: Math.max(used - 1, 0), updated_at: new Date().toISOString() })
    .eq("id", subscription.id)
    .eq(usedField, used)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Refund Tariff Boost Error:", error);
    return;
  }

  if (updated && operationId) {
    try {
      await supabase.from("processed_refund_operations").insert({
        operation_id: operationId,
        user_id: userId,
        subscription_id: subscription.id,
        operation_type: `${boostType}_boost_refund`,
      });
    } catch (insertErr) {
      if (insertErr?.code !== "23505") {
        console.warn("processed_refund_operations insert error:", insertErr?.message || insertErr);
      }
    }
  }
}

// Пытается списать 1 объявление с активного тарифа пользователя (одноразовый расход слота).
// Возвращает { hasSubscription: true, granted: true, remaining } при успехе,
// либо { hasSubscription: false } если у пользователя нет тарифа,
// либо { hasSubscription: true, granted: false, reason: "limit_reached" | "conflict" | "db_error" }.
export async function consumeTariffListing(userId) {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    return { hasSubscription: false };
  }

  let limit = 0;
  if (subscription.is_individual) {
    limit = subscription.active_listings_limit ?? 0;
  } else {
    const pricing = await getPricingSettings();
    const plan = pricing.tariffs[subscription.tariff_id];
    limit = plan?.activeListings ?? 0;
  }

  const used = subscription.listings_used ?? 0;

  if (used >= limit) {
    return { hasSubscription: true, granted: false, reason: "limit_reached", limit, used };
  }

  // Оптимистическая блокировка для защиты от состояния гонки
  const { data: updated, error } = await supabase
    .from("subscriptions")
    .update({ listings_used: used + 1, updated_at: new Date().toISOString() })
    .eq("id", subscription.id)
    .eq("listings_used", used)
    .select("id")
    .maybeSingle();

  if (error) {
    const isMissingColumn = error.code === "PGRST204" || error.code === "42703";
    const isDev = process.env.NODE_ENV !== "production";

    // Устранение fail-open (Пункт 13):
    // Только если колонка явно отсутствует в БД и ТОЛЬКО в dev-окружении допускаем fallback.
    // В production или при любых других ошибках БД публикация отклоняется (granted: false).
    if (isMissingColumn && isDev) {
      console.warn(
        "⚠️ WARNING: Column 'listings_used' is missing in 'subscriptions' table (dev fallback applied). " +
        "Please run this SQL in your Supabase SQL Editor:\n" +
        "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS listings_used INT NOT NULL DEFAULT 0;"
      );
      return { hasSubscription: true, granted: true, remaining: Math.max(limit - (used + 1), 0) };
    }

    console.error("Consume Tariff Listing Error:", error);
    return {
      hasSubscription: true,
      granted: false,
      reason: "db_error",
      message: "Ошибка базы данных при списании слота тарифа",
    };
  }

  if (!updated) {
    return { hasSubscription: true, granted: false, reason: "conflict" };
  }

  return { hasSubscription: true, granted: true, remaining: limit - (used + 1) };
}

// Возвращает списанный слот объявления ТОЛЬКО если создание объявления в БД завершилось сбоем
// (ошибка вставки фото или откат транзакции). При обычном удалении объявления пользователем этот метод НЕ вызывается.
// Атомарно уменьшает счётчик через Postgres RPC с защитой от повторов (operationId).
export async function refundTariffListing(userId, operationId = null) {
  if (!userId) return;

  // 1. Попытка атомарного возврата через Postgres RPC с защитой от гонок и идемпотентностью
  try {
    const { error } = await supabase.rpc("refund_tariff_listing_atomic", {
      p_user_id: userId,
      p_operation_id: operationId || null,
    });

    if (!error) {
      return;
    }
    console.warn("⚠️ refund_tariff_listing_atomic RPC failed, falling back:", error.message || error);
  } catch (err) {
    console.warn("⚠️ refund_tariff_listing_atomic RPC exception:", err.message);
  }

  // 2. Идемпотентность в фолбэке
  if (operationId) {
    try {
      const { data: alreadyProcessed } = await supabase
        .from("processed_refund_operations")
        .select("operation_id")
        .eq("operation_id", operationId)
        .maybeSingle();

      if (alreadyProcessed) {
        return;
      }
    } catch {
      // Игнорируем ошибку чтения processed_refund_operations при отсутствии таблицы в моках
    }
  }

  const subscription = await getActiveSubscription(userId);
  if (!subscription) return;

  const used = subscription.listings_used ?? 0;
  if (used <= 0) return;

  // Оптимистическая блокировка для защиты от гонок read-modify-write
  const { data: updated, error } = await supabase
    .from("subscriptions")
    .update({ listings_used: Math.max(used - 1, 0), updated_at: new Date().toISOString() })
    .eq("id", subscription.id)
    .eq("listings_used", used)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Refund Tariff Listing Error:", error);
    return;
  }

  if (updated && operationId) {
    try {
      await supabase.from("processed_refund_operations").insert({
        operation_id: operationId,
        user_id: userId,
        subscription_id: subscription.id,
        operation_type: "listing_refund",
      });
    } catch (insertErr) {
      if (insertErr?.code !== "23505") {
        console.warn("processed_refund_operations insert error:", insertErr?.message || insertErr);
      }
    }
  }
}

// Максимальное количество одновременных черновиков на пользователя
export const MAX_DRAFTS_PER_USER = 10;

// Считает количество объявлений со status = 'draft' у пользователя.
// Если count >= MAX_DRAFTS_PER_USER — возвращает { allowed: false, count, max: MAX_DRAFTS_PER_USER }
// Иначе { allowed: true }
export async function checkDraftsLimit(userId) {
  const { count, error } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "draft");

  if (error) {
    console.error("Check Drafts Limit Error:", error);
    return {
      allowed: false,
      count: 0,
      max: MAX_DRAFTS_PER_USER,
      message: "Ошибка проверки лимита черновиков",
    };
  }

  const draftsCount = count || 0;
  if (draftsCount >= MAX_DRAFTS_PER_USER) {
    return {
      allowed: false,
      count: draftsCount,
      max: MAX_DRAFTS_PER_USER,
    };
  }

  return {
    allowed: true,
    count: draftsCount,
    max: MAX_DRAFTS_PER_USER,
  };
}

// Единая функция активации слота объявления:
// 1. Получаем лимит пользователя (из тарифа/подписки или бесплатный лимит для personal = 2, для бизнеса = 0).
// 2. Считаем РЕАЛЬНОЕ количество активных неистёкших объявлений пользователя в БД:
//    SELECT count FROM listings WHERE user_id = userId AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
//    (если listingId передан и уже активен, он не увеличивает число).
// 3. Если реальный count >= limit:
//    возвращаем { granted: false, reason: "limit_reached", limit, count, message: `Достигнут лимит активных объявлений (${count} из ${limit})` }.
// 4. Если у пользователя есть тариф — также проверяем/списываем consumeTariffListing (счётчик listings_used как дополнительный барьер).
//    Если списание не прошло — возвращаем { granted: false, reason: "tariff_exhausted", message: ... }.
// 5. Возвращаем { granted: true, limit, count }.
export async function activateListingSlot(userId, listingId = null, accountType = null) {
  // 1. Лимит пользователя
  const limit = await getActiveListingsLimit(userId, accountType);

  // Проверяем, активно ли уже передаваемое объявление (listingId)
  let isAlreadyActive = false;
  if (listingId) {
    const { data: currentListing } = await supabase
      .from("listings")
      .select("id, status, expires_at, user_id")
      .eq("id", listingId)
      .maybeSingle();

    if (
      currentListing &&
      (!currentListing.user_id || currentListing.user_id === userId) &&
      currentListing.status === "active" &&
      (!currentListing.expires_at || new Date(currentListing.expires_at).getTime() > Date.now())
    ) {
      isAlreadyActive = true;
    }
  }

  // 2. Считаем реальное количество активных неистёкших объявлений
  const nowIso = new Date().toISOString();
  let countQuery = supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");

  let queryWasNeqFiltered = false;
  if (listingId && isAlreadyActive && typeof countQuery.neq === "function") {
    countQuery = countQuery.neq("id", listingId);
    queryWasNeqFiltered = true;
  }

  const { count: rawCount, error } = await countQuery.or(
    `expires_at.is.null,expires_at.gt.${nowIso}`
  );

  if (error) {
    console.error("Activate Listing Slot Count Error:", error);
    return {
      granted: false,
      reason: "error",
      limit,
      count: 0,
      message: "Ошибка проверки лимита активных объявлений",
    };
  }

  const count = Math.max(0, (rawCount || 0) - (isAlreadyActive && !queryWasNeqFiltered ? 1 : 0));

  // 3. Проверка count >= limit
  if (count >= limit) {
    return {
      granted: false,
      reason: "limit_reached",
      limit,
      count,
      message: `Достигнут лимит активных объявлений (${count} из ${limit})`,
    };
  }

  // 4. Если у пользователя есть тариф — проверяем/списываем слот с тарифа
  if (!isAlreadyActive) {
    const tariffResult = await consumeTariffListing(userId);
    if (tariffResult.hasSubscription && !tariffResult.granted) {
      return {
        granted: false,
        reason: tariffResult.reason === "db_error" ? "db_error" : "tariff_exhausted",
        limit,
        count,
        message:
          tariffResult.reason === "db_error"
            ? "Ошибка базы данных при списании слота тарифа"
            : `Лимит объявлений по вашему тарифу исчерпан (${limit} из ${limit}). Для размещения новых объявлений продлите тариф или выберите другой план.`,
      };
    }
  }

  // 5. Успешная активация слота
  return {
    granted: true,
    limit,
    count,
  };
}


