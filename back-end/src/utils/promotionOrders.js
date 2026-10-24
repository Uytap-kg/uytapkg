import { supabase } from "../config/db.js";

/**
 * Нормализует запись из таблицы promotion_orders для совместимости с кодом
 * контроллеров и сервисов (поддерживает и camelCase, и snake_case).
 */
function mapPromotionOrder(row) {
  if (!row) return null;
  return {
    id: row.order_id,
    orderId: row.order_id,
    order_id: row.order_id,
    userId: row.user_id,
    user_id: row.user_id,
    listingId: row.listing_id,
    listing_id: row.listing_id,
    serviceType: row.service_type,
    service_type: row.service_type,
    days: row.days,
    status: row.status,
    createdAt: row.created_at,
    created_at: row.created_at,
    appliedAt: row.applied_at,
    applied_at: row.applied_at,
  };
}

/**
 * Создаёт запись о заказе продвижения в таблице promotion_orders.
 * Вызывается сразу после создания записи в payments с данным orderId.
 */
export async function createPromotionOrder({ orderId, userId, listingId, serviceType, days }) {
  const newRow = {
    order_id: orderId,
    user_id: userId,
    listing_id: listingId,
    service_type: serviceType,
    days: Number(days),
    status: "pending",
  };

  const { data, error } = await supabase
    .from("promotion_orders")
    .insert(newRow)
    .select()
    .single();

  if (error) {
    console.error("Create promotion order DB error:", error);
    throw error;
  }

  return mapPromotionOrder(data);
}

/**
 * Возвращает заказ продвижения по order_id.
 * При ошибке запроса к БД выбрасывает исключение, не затирая данные.
 */
export async function getPromotionOrderByOrderId(orderId) {
  if (!orderId) return null;

  const { data, error } = await supabase
    .from("promotion_orders")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    console.error("Get promotion order DB error:", error);
    throw error;
  }

  return mapPromotionOrder(data);
}

/**
 * Обновляет статус заказа продвижения (pending -> applied | fulfillment_pending | canceled).
 * При ошибке запроса к БД выбрасывает исключение.
 */
export async function markPromotionOrderStatus(orderId, status) {
  if (!orderId) return null;

  const updates = { status };
  if (status === "applied" || status === "fulfillment_pending") {
    updates.applied_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("promotion_orders")
    .update(updates)
    .eq("order_id", orderId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Mark promotion order status DB error:", error);
    throw error;
  }

  return mapPromotionOrder(data);
}

/**
 * Возвращает список всех заказов продвижения для админ-панели (от новых к старым).
 * При ошибке запроса к БД выбрасывает исключение (не затирает пустым массивом).
 */
export async function listPromotionOrders(limit = 200) {
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 200));
  let query = supabase
    .from("promotion_orders")
    .select("order_id, user_id, listing_id, service_type, days, status, created_at, applied_at")
    .order("created_at", { ascending: false });

  if (typeof query?.limit === "function") {
    query = query.limit(safeLimit);
  }

  const { data, error } = await query;

  if (error) {
    console.error("List promotion orders DB error:", error);
    throw error;
  }

  return (data || []).slice(0, safeLimit).map(mapPromotionOrder);
}
