const API_URL = "/api";

import { saveAuth } from "@/utils/auth";

// 1. register
export async function registerUser(formData) {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(formData),
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    const errorMsg = Array.isArray(data.errors)
      ? data.errors.join(", ")
      : data.message || "Ошибка при регистрации";

    throw new Error(errorMsg);
  }

  // Email ещё не подтверждён: токен не выдаётся, saveAuth не вызываем.
  if (data.needVerification === true) {
    return data;
  }

  const token =
    data.token ||
    data.accessToken ||
    data.data?.token ||
    data.data?.accessToken;

  const user = data.user || data.data?.user || data.data;

  if (token) {
    saveAuth({
      token,
      user,
    });
  }

  return data;
}

// 1. login
export async function loginUser(credentials) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  // Бэкенд отказал во входе: email не подтверждён (403 + needVerification)
  if (data.needVerification === true) {
    const err = new Error(data.message || "Подтвердите email перед входом в аккаунт");
    err.needVerification = true;
    err.email = data.email;
    throw err;
  }

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при попытке входа");
  }

  const token =
    data.token ||
    data.accessToken ||
    data.data?.token ||
    data.data?.accessToken;

  const user = data.user || data.data?.user || data.data;

  if (token) {
    saveAuth({
      token,
      user,
    });
  }

  return data;
}

// 3. Отправка и проверка WhatsApp / SMS кода
export async function sendOtpCode(phone) {
  const response = await fetch(`${API_URL}/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  return response.json();
}

export async function verifyOtpCode(phone, code) {
  const response = await fetch(`${API_URL}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  return response.json();
}

// 4. Подтверждение email через OTP
export async function verifyEmailOtp(email, code) {
  const response = await fetch(`${API_URL}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    const err = new Error(data.message || "Неверный код");
    err.attemptsLeft = data.attemptsLeft;
    throw err;
  }

  if (data.token) {
    saveAuth({ token: data.token, user: data.user });
  }

  return data;
}

export async function resendEmailOtp(email) {
  const response = await fetch(`${API_URL}/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    const err = new Error(data.message || "Не удалось отправить код");
    err.status = response.status;
    throw err;
  }

  return data;
}

// 5. Восстановление пароля через Email OTP
export async function requestPasswordReset(email) {
  const response = await fetch(`${API_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    const err = new Error(data.message || "Не удалось отправить код восстановления");
    err.status = response.status;
    throw err;
  }

  return data;
}

export async function verifyPasswordResetCode(email, code) {
  const response = await fetch(`${API_URL}/auth/verify-reset-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    const err = new Error(data.message || "Неверный код восстановления");
    err.status = response.status;
    err.attemptsLeft = data.attemptsLeft;
    throw err;
  }

  return data;
}

export async function completePasswordReset(resetToken, newPassword) {
  const response = await fetch(`${API_URL}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resetToken, newPassword }),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    const err = new Error(data.message || "Не удалось обновить пароль");
    err.status = response.status;
    throw err;
  }

  return data;
}

// 6. Поиск и получение объявлений
export async function getListings(params = {}, options = {}) {
  const mappedParams = { ...params };
  if (params.category) {
    mappedParams.propertyType = params.category;
    delete mappedParams.category;
  }
  if (params.settlement) {
    mappedParams.city = params.settlement;
    delete mappedParams.settlement;
  }
  if (params.priceFrom) {
    mappedParams.minPrice = params.priceFrom;
    delete mappedParams.priceFrom;
  }
  if (params.priceTo) {
    mappedParams.maxPrice = params.priceTo;
    delete mappedParams.priceTo;
  }
  if (params.rentalPeriod && !Array.isArray(params.rentalPeriod)) {
    mappedParams.rentPeriod = params.rentalPeriod;
    delete mappedParams.rentalPeriod;
  }

  const cleanParams = {};
  for (const [key, val] of Object.entries(mappedParams)) {
    if (val === undefined || val === null || val === "") continue;
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      cleanParams[key] = val.join(",");
    } else {
      cleanParams[key] = val;
    }
  }

  const query = new URLSearchParams(cleanParams).toString();
  const response = await fetch(`${API_URL}/listings?${query}`, {
    signal: options?.signal,
    ...options,
  });
  return response.json();
}

/**
 * Получение легковесного списка объявлений для карты (GET /api/listings/map).
 * Содержит только объекты с координатами и минимально необходимые поля для маркеров.
 */
export async function getMapListings(params = {}) {
  const mappedParams = { ...params };
  if (params.category) {
    mappedParams.propertyType = params.category;
    delete mappedParams.category;
  }
  if (params.settlement) {
    mappedParams.city = params.settlement;
    delete mappedParams.settlement;
  }
  if (params.priceFrom) {
    mappedParams.minPrice = params.priceFrom;
    delete mappedParams.priceFrom;
  }
  if (params.priceTo) {
    mappedParams.maxPrice = params.priceTo;
    delete mappedParams.priceTo;
  }
  if (params.rentalPeriod) {
    mappedParams.rentPeriod = params.rentalPeriod;
    delete mappedParams.rentalPeriod;
  }

  const query = new URLSearchParams(mappedParams).toString();
  const response = await fetch(`${API_URL}/listings/map?${query}`);
  return response.json();
}

/**
 * Загрузка всех страниц объявлений без ограничения сервера в 100 записей (P1-3).
 * Запрашивает первую страницу, узнает total, и если записей > 100, догружает остальные
 * страницы параллельно порциями по 100 штук (до maxItems).
 */
export async function getAllListings(params = {}, maxItems = 2000) {
  const pageSize = 100;
  const firstPageRes = await getListings({
    ...params,
    page: 1,
    limit: pageSize,
  });

  if (!firstPageRes?.success || !Array.isArray(firstPageRes.data)) {
    return firstPageRes;
  }

  const items = [...firstPageRes.data];
  const total = firstPageRes.pagination?.total ?? items.length;

  if (total > items.length && items.length < maxItems) {
    const totalToFetch = Math.min(total, maxItems);
    const totalPages = Math.ceil(totalToFetch / pageSize);
    const pagePromises = [];

    for (let p = 2; p <= totalPages; p++) {
      pagePromises.push(
        getListings({
          ...params,
          page: p,
          limit: pageSize,
        }).catch((err) => {
          console.error(`Error loading listings page ${p}:`, err);
          return null;
        })
      );
    }

    const restPages = await Promise.all(pagePromises);
    for (const pageRes of restPages) {
      if (pageRes?.success && Array.isArray(pageRes.data)) {
        items.push(...pageRes.data);
      }
    }
  }

  return {
    success: true,
    data: items,
    pagination: {
      total: items.length,
      page: 1,
      limit: items.length,
    },
  };
}

export async function createListing(token, payload) {
  const response = await fetch(`${API_URL}/listings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    if (data.errors && Array.isArray(data.errors)) {
      throw new Error(
        `${data.message || "Ошибка валидации данных"}: ${data.errors.join(", ")}`,
      );
    }
    throw new Error(data.message || "Ошибка создания объявления");
  }

  return data;
}

// 5. Жилые комплексы
export async function getComplexes() {
  const response = await fetch(`${API_URL}/complexes`);
  return response.json();
}

// 6. Умный AI поиск
export async function aiSearchQuery(prompt) {
  const response = await fetch(`${API_URL}/ai/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return response.json();
}

export async function generateDescription(details) {
  const response = await fetch(`${API_URL}/ai/generate-description`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ details }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка генерации описания");
  }
  return data.generatedText;
}

// 7. Профиль
export async function getUserPublicProfile(id) {
  const response = await fetch(`${API_URL}/auth/users/${id}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Ошибка получения публичного профиля");
  }

  return data;
}

// Сводка по текущему тарифу пользователя (активен/тип/остаток
// объявлений и поднятий VIP/TOP) — блок "Мой тариф" в профиле.
export async function getMySubscription(token) {
  const response = await fetch(`${API_URL}/subscriptions/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения данных тарифа");
  }

  return data.data;
}

export async function getMe(token) {
  const response = await fetch(`${API_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Ошибка получения пользователя");
  }

  return data.user;
}

export async function updateMe(token, payload) {
  const response = await fetch(`${API_URL}/auth/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка обновления профиля");
  }

  return data.user;
}

// 8. Загрузка картинок и аватаров
export async function uploadImage(file) {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_URL}/upload`, {
    method: "POST",
    body: form,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при загрузке изображения");
  }
  return data.url;
}

// Фото объявлений — сервер всегда накладывает водяной знак (лого UyTap)
export async function uploadListingPhoto(token, file) {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_URL}/upload/listing-photo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при загрузке фотографии");
  }
  return data.url;
}

// Фото ЖК — сервер всегда накладывает водяной знак (лого UyTap)
export async function uploadComplexPhoto(token, file) {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_URL}/upload/complex-photo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при загрузке фотографии ЖК");
  }
  return data.url;
}

export async function uploadAvatar(token, file) {
  const form = new FormData();
  form.append("avatar", file);

  const response = await fetch(`${API_URL}/auth/avatar`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при загрузке аватара");
  }
  return data;
}

export async function deleteAvatar(token) {
  const response = await fetch(`${API_URL}/auth/avatar`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при удалении аватара");
  }
  return data;
}

export async function getListingById(id, token = null) {
  const headers = {};
  const authToken =
    token ||
    (typeof window !== "undefined" ? localStorage.getItem("uytap_token") : null);
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  const response = await fetch(`${API_URL}/listings/${id}`, { headers });
  return response.json();
}

export async function getComplexById(id) {
  const response = await fetch(`${API_URL}/complexes/${id}`);
  return response.json();
}

export async function getComplexListings(id) {
  const response = await fetch(`${API_URL}/complexes/${id}/listings`);
  return response.json();
}

export async function getDevelopers() {
  const response = await fetch(`${API_URL}/developers`);
  return response.json();
}

export async function getDeveloperById(id) {
  const response = await fetch(`${API_URL}/developers/${id}`);
  return response.json();
}

export async function getConstants() {
  const response = await fetch(`${API_URL}/constants`);
  return response.json();
}

export async function createComplex(token, payload) {
  const response = await fetch(`${API_URL}/complexes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function updateComplex(token, id, payload) {
  const response = await fetch(`${API_URL}/complexes/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function deleteComplex(token, id) {
  const response = await fetch(`${API_URL}/complexes/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

export async function getMyComplexes(token) {
  const response = await fetch(`${API_URL}/complexes/my`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

// 8. Избранное
export async function getFavorites(token) {
  const response = await fetch(`${API_URL}/favorites`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

export async function addFavorite(token, listingId) {
  const response = await fetch(`${API_URL}/favorites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ listingId }),
  });
  return response.json();
}

export async function removeFavorite(token, listingId) {
  const response = await fetch(`${API_URL}/favorites/${listingId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

// 9. Мои объявления (CRUD)
export async function getMyListings(token) {
  const response = await fetch(`${API_URL}/listings/my`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

export async function updateListing(token, id, payload) {
  const response = await fetch(`${API_URL}/listings/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function deleteListing(token, id) {
  const response = await fetch(`${API_URL}/listings/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

export async function renewListing(token, id) {
  const res = await fetch(`${API_URL}/listings/${id}/renew`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || "Ошибка продления объявления");
  }
  return data;
}

// 10. Оплата тарифов (O!Dengi)
export async function createPayment(token, { tariffId, months }) {
  const response = await fetch(`${API_URL}/payments/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tariffId, months }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка создания платежа");
  }

  return data.data;
}

export async function createPromotionPayment(
  token,
  { listingId, serviceType, days },
) {
  const response = await fetch(`${API_URL}/payments/promotion/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ listingId, serviceType, days }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка создания платежа");
  }

  return data.data;
}

// Бесплатное поднятие VIP/TOP за счёт лимита тарифа — пробуем ДО того,
// как вести пользователя на оплату. { granted: false } — у пользователя
// нет тарифа/лимит исчерпан, нужно продолжить обычной платной покупкой.
export async function promoteListingWithTariff(
  token,
  listingId,
  { serviceType, days },
) {
  const response = await fetch(
    `${API_URL}/listings/${listingId}/promote-with-tariff`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ serviceType, days }),
    },
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка проверки тарифа");
  }

  return data.data;
}

export async function getPaymentStatus(token, orderId) {
  const response = await fetch(`${API_URL}/payments/${orderId}/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения статуса платежа");
  }

  return data.data;
}

export async function cancelPayment(token, orderId) {
  const response = await fetch(`${API_URL}/payments/${orderId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

// 11. Админка
export async function getAdminStats(token) {
  const response = await fetch(`${API_URL}/admin/stats`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения статистики дашборда");
  }
  return data;
}

export async function getAdminPayments(token) {
  const response = await fetch(`${API_URL}/admin/payments`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения списка платежей");
  }

  return data;
}

// Текущие цены тарифов и услуг — публичный эндпоинт, без токена
export async function getPricing() {
  const response = await fetch(`${API_URL}/settings/pricing`);

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения цен");
  }

  return data.data;
}

// Изменение цен тарифов и услуг — только для админа
export async function updatePricing(token, pricing) {
  const response = await fetch(`${API_URL}/admin/pricing`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(pricing),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось сохранить цены");
  }

  return data.data;
}

// Поиск пользователя по номеру телефона (выдача индивидуального тарифа)
export async function searchAdminUsers(token, phone) {
  const response = await fetch(
    `${API_URL}/admin/users/search?phone=${encodeURIComponent(phone)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка поиска пользователей");
  }

  return data.data;
}

// Дефолтные тарифы (start/optimal/business), купленные через оплату
export async function getDefaultTariffs(token) {
  const response = await fetch(`${API_URL}/admin/tariffs/default`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения списка тарифов");
  }

  return data.data;
}

export async function updateDefaultTariffPeriod(
  token,
  id,
  { startDate, endDate },
) {
  const response = await fetch(
    `${API_URL}/admin/tariffs/default/${id}/period`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ startDate, endDate }),
    },
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось изменить период тарифа");
  }

  return data.data;
}

export async function toggleDefaultTariff(token, id) {
  const response = await fetch(
    `${API_URL}/admin/tariffs/default/${id}/toggle`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось изменить статус тарифа");
  }

  return data.data;
}

// Индивидуальные тарифы, выданные вручную одному пользователю
export async function getIndividualTariffs(token) {
  const response = await fetch(`${API_URL}/admin/tariffs/individual`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения списка тарифов");
  }

  return data.data;
}

export async function createIndividualTariff(token, payload) {
  const response = await fetch(`${API_URL}/admin/tariffs/individual`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось выдать тариф");
  }

  return data.data;
}

export async function updateIndividualTariff(token, id, payload) {
  const response = await fetch(`${API_URL}/admin/tariffs/individual/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось изменить тариф");
  }

  return data.data;
}

export async function toggleIndividualTariff(token, id) {
  const response = await fetch(
    `${API_URL}/admin/tariffs/individual/${id}/toggle`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось изменить статус тарифа");
  }

  return data.data;
}

// 12. Юристы

// Публичный список — только активные (страница /lawyers)
export async function getLawyers() {
  const response = await fetch(`${API_URL}/lawyers`);
  return response.json();
}

// Список для админки — все юристы, включая выключенных
export async function getAdminLawyers(token) {
  const response = await fetch(`${API_URL}/admin/lawyers`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения списка юристов");
  }

  return data.data;
}

export async function createLawyer(token, payload) {
  const response = await fetch(`${API_URL}/admin/lawyers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    const errorMsg = Array.isArray(data.errors)
      ? data.errors.join(", ")
      : data.message || "Ошибка добавления юриста";
    throw new Error(errorMsg);
  }

  return data.data;
}

export async function updateLawyer(token, id, payload) {
  const response = await fetch(`${API_URL}/admin/lawyers/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    const errorMsg = Array.isArray(data.errors)
      ? data.errors.join(", ")
      : data.message || "Ошибка обновления юриста";
    throw new Error(errorMsg);
  }

  return data.data;
}

export async function deleteLawyer(token, id) {
  const response = await fetch(`${API_URL}/admin/lawyers/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка удаления юриста");
  }

  return data;
}

// 12. Верификация застройщиков
export async function getVerificationStatus(token) {
  const response = await fetch(`${API_URL}/auth/verification-status`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

export async function uploadVerificationDocument(token, file) {
  const form = new FormData();
  form.append("document", file);

  const response = await fetch(`${API_URL}/auth/verify-documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при загрузке документа");
  }
  return data;
}

export async function submitVerificationRequest(token, documents) {
  const response = await fetch(`${API_URL}/auth/verify-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ documents }),
  });
  return response.json();
}

export async function getAdminDevelopers(token) {
  const response = await fetch(`${API_URL}/admin/developers`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при загрузке списка застройщиков");
  }
  return data.data;
}

export async function verifyDeveloperAdmin(
  token,
  id,
  isVerified,
  rejectionReason = "",
) {
  const response = await fetch(`${API_URL}/admin/developers/${id}/verify`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ isVerified, rejectionReason }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при верификации застройщика");
  }
  return data;
}

// Заявки на публикацию объявлений в Instagram
export async function getAdminInstagramRequests(token) {
  const response = await fetch(`${API_URL}/admin/instagram-requests`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при загрузке заявок на Instagram");
  }
  return data.data;
}

export async function completeInstagramRequest(token, id) {
  const response = await fetch(
    `${API_URL}/admin/instagram-requests/${id}/complete`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при обновлении заявки");
  }
  return data;
}

// 13. Рекламные баннеры

// Публичный список активных баннеров — без токена
export async function getBanners() {
  const response = await fetch(`${API_URL}/banners`);
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения баннеров");
  }
  return data.data;
}

// Список всех баннеров для админки
export async function getAdminBanners(token) {
  const response = await fetch(`${API_URL}/admin/banners`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка получения списка баннеров");
  }
  return data.data;
}

// Загрузка изображения баннера — возвращает { success, url }
export async function uploadBannerImage(token, file) {
  const form = new FormData();
  form.append("image", file);

  const response = await fetch(`${API_URL}/admin/banners/upload-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Ошибка при загрузке изображения");
  }
  return data;
}

export async function createBanner(token, banner) {
  const response = await fetch(`${API_URL}/admin/banners`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(banner),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось создать баннер");
  }
  return data.data;
}

export async function updateBanner(token, id, banner) {
  const response = await fetch(`${API_URL}/admin/banners/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(banner),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось сохранить баннер");
  }
  return data.data;
}

export async function toggleBanner(token, id) {
  const response = await fetch(`${API_URL}/admin/banners/${id}/toggle`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось изменить статус баннера");
  }
  return data.data;
}

export async function deleteBanner(token, id) {
  const response = await fetch(`${API_URL}/admin/banners/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не удалось удалить баннер");
  }
  return data;
}
