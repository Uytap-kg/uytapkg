import { supabase } from "../config/db.js";
import {
  tariffPeriodSchema,
  createIndividualTariffSchema,
  updateIndividualTariffSchema,
  userPhoneSearchSchema,
} from "../utils/validation.js";

// =======================================================
// Управление тарифами пользователей из админки:
//   - "Дефолтные тарифы" (/admin/defaultTarrifs) — пользователи, купившие
//     один из стандартных тарифов (start/optimal/business) через
//     платёжный флоу (см. paymentsController.js → activateSubscription).
//   - "Управление тарифами" (/admin/tarrifs) — индивидуальные тарифы,
//     которые админ выдаёт вручную одному пользователю (оплата по
//     реквизитам, вне платёжной системы), с произвольным названием и
//     лимитами.
//
// Обе сущности живут в одной таблице `subscriptions` (см. schema.sql —
// добавлены колонки started_at/is_active/is_individual/custom_name/
// active_listings_limit/vip_boosts_limit/top_boosts_limit/granted_by):
// у пользователя может быть только один активный тариф одновременно
// (UNIQUE(user_id)), а флаг is_individual разделяет два раздела админки.
// =======================================================

const NESTED_USER_SELECT =
  "id, email, phone, user_profiles(first_name, last_name, company_name)";

function resolveDisplayName(user) {
  const profile = Array.isArray(user?.user_profiles)
    ? user.user_profiles[0]
    : user?.user_profiles;

  const fullName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || profile?.company_name || user?.email || user?.phone || "Пользователь";
}

function toDateOnly(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toISOString().slice(0, 10);
}

// Даты приходят с фронта как YYYY-MM-DD (без времени) — начало периода
// фиксируем на начало дня UTC, конец периода на конец дня UTC, чтобы
// последний день периода оставался включительно активным.
function startOfDayIso(dateOnly) {
  return new Date(`${dateOnly}T00:00:00.000Z`).toISOString();
}

function endOfDayIso(dateOnly) {
  return new Date(`${dateOnly}T23:59:59.999Z`).toISOString();
}

function toDefaultTariffDto(row) {
  const user = row.users;

  return {
    id: row.id,
    userId: user?.id || null,
    name: resolveDisplayName(user),
    email: user?.email || null,
    phone: user?.phone || null,
    tariff: row.tariff_id,
    startDate: toDateOnly(row.started_at),
    endDate: toDateOnly(row.expires_at),
    active: Boolean(row.is_active),
  };
}

function toIndividualTariffDto(row) {
  const user = row.users;

  return {
    id: row.id,
    userId: user?.id || null,
    userName: resolveDisplayName(user),
    phone: user?.phone || null,
    name: row.custom_name,
    activeListings: row.active_listings_limit,
    vipBoosts: row.vip_boosts_limit,
    topBoosts: row.top_boosts_limit,
    startDate: toDateOnly(row.started_at),
    endDate: toDateOnly(row.expires_at),
    isActive: Boolean(row.is_active),
  };
}

// =======================================================
// GET /api/admin/users/search?phone=... — поиск пользователя по номеру
// телефона (используется модалкой выдачи индивидуального тарифа).
// Поиск сравнивает только цифры номера, поэтому не важно, вводит ли
// админ номер с "+996", пробелами или без.
// =======================================================
export const searchUsersByPhone = async (req, res) => {
  try {
    const result = userPhoneSearchSchema.safeParse(req.query);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error.issues[0]?.message || "Некорректный запрос",
      });
    }

    const digits = result.data.phone.replace(/\D/g, "");

    if (digits.length < 3) {
      return res.json({ success: true, data: [] });
    }

    const { data, error } = await supabase
      .from("users")
      .select(NESTED_USER_SELECT)
      .ilike("phone", `%${digits}%`)
      .limit(10);

    if (error) {
      console.error("Search Users By Phone Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при поиске пользователей",
      });
    }

    return res.json({
      success: true,
      data: (data || []).map((user) => ({
        id: user.id,
        name: resolveDisplayName(user),
        phone: user.phone,
      })),
    });
  } catch (error) {
    console.error("Search Users By Phone Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при поиске пользователей",
    });
  }
};

// =======================================================
// GET /api/admin/tariffs/default — список пользователей на стандартных
// тарифах (start/optimal/business), купленных через платёжную систему.
// =======================================================
export const listDefaultTariffs = async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query || {};
    const pageNum = Math.min(1000, Math.max(1, parseInt(page, 10) || 1));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from("subscriptions")
      .select(`id, tariff_id, started_at, expires_at, is_active, users!subscriptions_user_id_fkey(${NESTED_USER_SELECT})`)
      .eq("is_individual", false)
      .order("created_at", { ascending: false });

    if (typeof query?.range === "function") {
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      console.error("List Default Tariffs Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении списка тарифов",
        requestId: req?.id,
      });
    }

    const items = (data || []).slice(0, limitNum).filter((row) => row.users).map(toDefaultTariffDto);

    return res.json({
      success: true,
      data: items,
      pagination: { page: pageNum, limit: limitNum },
    });
  } catch (error) {
    console.error("List Default Tariffs Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении тарифов",
      requestId: req?.id,
    });
  }
};

// =======================================================
// PATCH /api/admin/tariffs/default/:id/period — изменить период
// (дату начала/окончания) дефолтного тарифа пользователя.
// =======================================================
export const updateDefaultTariffPeriod = async (req, res) => {
  try {
    const { id } = req.params;
    const result = tariffPeriodSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error.issues[0]?.message || "Некорректные данные периода",
      });
    }

    const { startDate, endDate } = result.data;

    const { data: updated, error } = await supabase
      .from("subscriptions")
      .update({
        started_at: startOfDayIso(startDate),
        expires_at: endOfDayIso(endDate),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("is_individual", false)
      .select(`id, tariff_id, started_at, expires_at, is_active, users!subscriptions_user_id_fkey(${NESTED_USER_SELECT})`)
      .maybeSingle();

    if (error) {
      console.error("Update Default Tariff Period Error:", error);
      return res.status(500).json({
        success: false,
        message: "Не удалось изменить период тарифа",
      });
    }

    if (!updated) {
      return res.status(404).json({ success: false, message: "Тариф не найден" });
    }

    return res.json({ success: true, data: toDefaultTariffDto(updated) });
  } catch (error) {
    console.error("Update Default Tariff Period Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при изменении периода тарифа",
    });
  }
};

// =======================================================
// PATCH /api/admin/tariffs/default/:id/toggle — включить/отключить
// дефолтный тариф пользователя.
// =======================================================
export const toggleDefaultTariff = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: current, error: fetchError } = await supabase
      .from("subscriptions")
      .select("is_active")
      .eq("id", id)
      .eq("is_individual", false)
      .maybeSingle();

    if (fetchError) {
      console.error("Toggle Default Tariff Fetch Error:", fetchError);
      return res.status(500).json({ success: false, message: "Ошибка при поиске тарифа" });
    }

    if (!current) {
      return res.status(404).json({ success: false, message: "Тариф не найден" });
    }

    const { data: updated, error } = await supabase
      .from("subscriptions")
      .update({ is_active: !current.is_active, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(`id, tariff_id, started_at, expires_at, is_active, users!subscriptions_user_id_fkey(${NESTED_USER_SELECT})`)
      .maybeSingle();

    if (error) {
      console.error("Toggle Default Tariff Error:", error);
      return res.status(500).json({
        success: false,
        message: "Не удалось изменить статус тарифа",
      });
    }

    return res.json({ success: true, data: toDefaultTariffDto(updated) });
  } catch (error) {
    console.error("Toggle Default Tariff Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при изменении статуса тарифа",
    });
  }
};

// =======================================================
// GET /api/admin/tariffs/individual — список индивидуальных тарифов.
// =======================================================
export const listIndividualTariffs = async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query || {};
    const pageNum = Math.min(1000, Math.max(1, parseInt(page, 10) || 1));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from("subscriptions")
      .select(
        `id, custom_name, active_listings_limit, vip_boosts_limit, top_boosts_limit,
         started_at, expires_at, is_active, users!subscriptions_user_id_fkey(${NESTED_USER_SELECT})`
      )
      .eq("is_individual", true)
      .order("created_at", { ascending: false });

    if (typeof query?.range === "function") {
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      console.error("List Individual Tariffs Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении списка тарифов",
        requestId: req?.id,
      });
    }

    const items = (data || []).slice(0, limitNum).filter((row) => row.users).map(toIndividualTariffDto);

    return res.json({
      success: true,
      data: items,
      pagination: { page: pageNum, limit: limitNum },
    });
  } catch (error) {
    console.error("List Individual Tariffs Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении тарифов",
      requestId: req?.id,
    });
  }
};

// =======================================================
// POST /api/admin/tariffs/individual — выдать индивидуальный тариф
// пользователю (оплата принята вручную, вне платёжной системы).
//
// Таблица subscriptions хранит один тариф на пользователя
// (UNIQUE(user_id)) — если у пользователя уже была подписка (дефолтная
// или индивидуальная), она осознанно заменяется новой: у пользователя
// не может быть двух одновременно активных тарифов.
// =======================================================
export const createIndividualTariff = async (req, res) => {
  try {
    const result = createIndividualTariffSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error.issues[0]?.message || "Некорректные данные тарифа",
      });
    }

    const { userId, name, activeListings, vipBoosts, topBoosts, startDate, endDate } = result.data;

    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select(NESTED_USER_SELECT)
      .eq("id", userId)
      .maybeSingle();

    if (userError) {
      console.error("Create Individual Tariff — Find User Error:", userError);
      return res.status(500).json({ success: false, message: "Ошибка при поиске пользователя" });
    }

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "Пользователь не найден" });
    }

    const { data: saved, error } = await supabase
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          tariff_id: "individual",
          is_individual: true,
          custom_name: name,
          active_listings_limit: activeListings,
          vip_boosts_limit: vipBoosts,
          top_boosts_limit: topBoosts,
          // Свежая выдача тарифа — счётчики использованных поднятий и слотов
          // начинаются заново, даже если у пользователя уже был тариф.
          listings_used: 0,
          vip_boosts_used: 0,
          top_boosts_used: 0,
          started_at: startOfDayIso(startDate),
          expires_at: endOfDayIso(endDate),
          is_active: true,
          granted_by: req.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select("id, custom_name, active_listings_limit, vip_boosts_limit, top_boosts_limit, started_at, expires_at, is_active")
      .single();

    if (error) {
      console.error("Create Individual Tariff Error:", error);
      return res.status(500).json({ success: false, message: "Не удалось выдать тариф" });
    }

    return res.status(201).json({
      success: true,
      data: toIndividualTariffDto({ ...saved, users: targetUser }),
    });
  } catch (error) {
    console.error("Create Individual Tariff Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при выдаче тарифа",
    });
  }
};

// =======================================================
// PUT /api/admin/tariffs/individual/:id — изменить условия и период
// индивидуального тарифа. Пользователь, которому он выдан, не меняется.
// =======================================================
export const updateIndividualTariff = async (req, res) => {
  try {
    const { id } = req.params;
    const result = updateIndividualTariffSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error.issues[0]?.message || "Некорректные данные тарифа",
      });
    }

    const { name, activeListings, vipBoosts, topBoosts, startDate, endDate } = result.data;

    const { data: updated, error } = await supabase
      .from("subscriptions")
      .update({
        custom_name: name,
        active_listings_limit: activeListings,
        vip_boosts_limit: vipBoosts,
        top_boosts_limit: topBoosts,
        started_at: startOfDayIso(startDate),
        expires_at: endOfDayIso(endDate),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("is_individual", true)
      .select(
        `id, custom_name, active_listings_limit, vip_boosts_limit, top_boosts_limit,
         started_at, expires_at, is_active, users!subscriptions_user_id_fkey(${NESTED_USER_SELECT})`
      )
      .maybeSingle();

    if (error) {
      console.error("Update Individual Tariff Error:", error);
      return res.status(500).json({ success: false, message: "Не удалось изменить тариф" });
    }

    if (!updated) {
      return res.status(404).json({ success: false, message: "Тариф не найден" });
    }

    return res.json({ success: true, data: toIndividualTariffDto(updated) });
  } catch (error) {
    console.error("Update Individual Tariff Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при изменении тарифа",
    });
  }
};

// =======================================================
// PATCH /api/admin/tariffs/individual/:id/toggle — включить/отключить
// индивидуальный тариф.
// =======================================================
export const toggleIndividualTariff = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: current, error: fetchError } = await supabase
      .from("subscriptions")
      .select("is_active")
      .eq("id", id)
      .eq("is_individual", true)
      .maybeSingle();

    if (fetchError) {
      console.error("Toggle Individual Tariff Fetch Error:", fetchError);
      return res.status(500).json({ success: false, message: "Ошибка при поиске тарифа" });
    }

    if (!current) {
      return res.status(404).json({ success: false, message: "Тариф не найден" });
    }

    const { data: updated, error } = await supabase
      .from("subscriptions")
      .update({ is_active: !current.is_active, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(
        `id, custom_name, active_listings_limit, vip_boosts_limit, top_boosts_limit,
         started_at, expires_at, is_active, users!subscriptions_user_id_fkey(${NESTED_USER_SELECT})`
      )
      .maybeSingle();

    if (error) {
      console.error("Toggle Individual Tariff Error:", error);
      return res.status(500).json({
        success: false,
        message: "Не удалось изменить статус тарифа",
      });
    }

    return res.json({ success: true, data: toIndividualTariffDto(updated) });
  } catch (error) {
    console.error("Toggle Individual Tariff Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при изменении статуса тарифа",
    });
  }
};
