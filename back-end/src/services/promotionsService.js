import { supabase } from "../config/db.js";
import { markPromotionOrderStatus } from "../utils/promotionOrders.js";
import { activateListingSlot } from "./subscriptionsService.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Выставляет флаг продвижения (VIP/ТОП/Срочно) + срок истечения в колонках listings
// (promotion_expires_at, urgent_expires_at). Сроки хранятся строго в колонках listings,
// а не внутри features.
// Общая логика для источников продвижения:
// оплаченного заказа (applyPromotion ниже), бесплатного списания с тарифа
// при создании и через /:id/promote-with-tariff (см.
// controllers/listingsController.js). Возвращает true, если продвижение
// применено.
export async function grantPromotion({ listingId, serviceType, days }) {
  const { data: listing, error } = await supabase
    .from("listings")
    .select("id, status, user_id, promotion_status, is_urgent, promotion_expires_at, urgent_expires_at")
    .eq("id", listingId)
    .maybeSingle();

  if (error || !listing) {
    console.error("Grant Promotion: listing not found", listingId, error);
    return false;
  }

  const expiresAt = new Date(Date.now() + Number(days) * DAY_MS).toISOString();

  const updates = { updated_at: new Date().toISOString() };

  // Объявления, купленные платным типом размещения (VIP/ТОП/Срочно) без
  // покрытия тарифом, создаются в controllers/listingsController.js
  // createListing статусом "draft" и не публикуются, пока не подтвердится
  // оплата — grantPromotion вызывается именно в момент этого
  // подтверждения (см. paymentsController.js reconcilePaymentStatus →
  // promotionsService.applyPromotion), поэтому здесь же и переводим
  // объявление в "active". "hidden" — по той же логике: покупка
  // продвижения для скрытого объявления возвращает его в публичную выдачу
  // (осознанное действие владельца). "moderation" НЕ трогаем — снять с
  // модерации может только admin, оплата продвижения это не обходит.
  if (listing.status === "draft" || listing.status === "hidden") {
    const slot = await activateListingSlot(listing.user_id, listingId);
    if (!slot.granted) {
      console.error(
        `Grant Promotion: Cannot activate listing ${listingId} for user ${listing.user_id}: ${slot.message}`
      );
      return false;
    }
    updates.status = "active";
  }

  const now = Date.now();
  const currentPromo = listing.promotion_status;
  const promoExp = listing.promotion_expires_at ? new Date(listing.promotion_expires_at).getTime() : 0;
  const urgentExp = listing.urgent_expires_at ? new Date(listing.urgent_expires_at).getTime() : 0;
  const isVipActive = currentPromo === "vip" && (!listing.promotion_expires_at || promoExp > now);
  const isUrgentActive = Boolean(listing.is_urgent) && (!listing.urgent_expires_at || urgentExp > now);

  if (serviceType === "vip") {
    updates.promotion_status = "vip";
    updates.promotion_expires_at = expiresAt;
    updates.priority_rank = 0;
  } else if (serviceType === "urgent") {
    updates.is_urgent = true;
    updates.urgent_expires_at = expiresAt;
    updates.priority_rank = isVipActive ? 0 : 1;
  } else if (serviceType === "top") {
    updates.promotion_status = "top";
    updates.promotion_expires_at = expiresAt;
    if (isVipActive) {
      updates.priority_rank = 0;
    } else if (isUrgentActive) {
      updates.priority_rank = 1;
    } else {
      updates.priority_rank = 2;
    }
  } else {
    console.error("Grant Promotion: unknown serviceType", serviceType);
    return false;
  }

  const { error: updateError } = await supabase
    .from("listings")
    .update(updates)
    .eq("id", listingId);

  if (updateError) {
    console.error("Grant Promotion Update Error:", updateError);
    return false;
  }

  return true;
}

// Применяет купленное продвижение к объявлению после подтверждённой оплаты.
// Instagram-продвижение — это ручная публикация сотрудником, а не флаг на
// объявлении, поэтому для него мы просто помечаем заказ как "ожидает
// публикации" — админ увидит его в списке заказов и выполнит вручную.
export async function applyPromotion(order) {
  const { listingId, serviceType, days } = order;

  if (serviceType === "instagram") {
    await markPromotionOrderStatus(order.orderId, "fulfillment_pending");
    return;
  }

  const applied = await grantPromotion({ listingId, serviceType, days });

  if (applied) {
    await markPromotionOrderStatus(order.orderId, "applied");
  }
}

// Продвижение покупается на ограниченный срок (days), но в listings нет
// автоматического job'а, который бы его снимал — вместо cron-задачи
// используем ленивую проверку "истёк ли срок" прямо при чтении объявления:
// каждый read-путь (getListings/getListingById/getMyListings) прогоняет
// строку через эту функцию и показывает клиенту уже актуальное состояние,
// даже если БД ещё не обновлена. Сама функция ничего не пишет в БД —
// вызывающий код (см. downgradeExpiredPromotionInDb в listingsController.js)
// решает, стоит ли фиксировать исправление.
//
// Сроки берутся строго из колонок listing.promotion_expires_at и
// listing.urgent_expires_at (НЕ из features).
// Принцип Fail-Closed: если promotion_status ∈ ('vip', 'top'), но
// promotion_expires_at отсутствует (null/undefined/невалидная дата) — считать
// продвижение ИСТЁКШИМ (сбрасывать в regular).
// Если is_urgent === true, но urgent_expires_at отсутствует — сбрасывать is_urgent в false.
// Если срок наступил (<= Date.now()) — также сбрасывать статус.
export function resolvePromotionExpiry(listing) {
  const now = Date.now();

  let promotionStatus = listing?.promotion_status ?? "regular";
  let isUrgent = Boolean(listing?.is_urgent);
  let changed = false;

  if (promotionStatus === "vip" || promotionStatus === "top") {
    const promoExpiresAt = listing?.promotion_expires_at;
    const expiresTime = promoExpiresAt ? new Date(promoExpiresAt).getTime() : NaN;
    if (!promoExpiresAt || isNaN(expiresTime) || expiresTime <= now) {
      promotionStatus = "regular";
      changed = true;
    }
  }

  if (isUrgent) {
    const urgentExpiresAt = listing?.urgent_expires_at;
    const expiresTime = urgentExpiresAt ? new Date(urgentExpiresAt).getTime() : NaN;
    if (!urgentExpiresAt || isNaN(expiresTime) || expiresTime <= now) {
      isUrgent = false;
      changed = true;
    }
  }

  return { promotionStatus, isUrgent, changed };
}
