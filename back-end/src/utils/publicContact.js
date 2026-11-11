// Единое правило показа телефона в публичных ответах (профили, каталог риэлторов).
//
// - Бизнес-аккаунты (риэлтор, агентство, застройщик): телефон — рабочий контакт,
//   обязателен при регистрации и уже показывается в их объявлениях
//   (см. sanitizeAuthorPII в listingsController.js) — отдаём всегда.
// - Частные продавцы (personal): только при явном согласии show_phone === true
//   (COMMENT ON COLUMN users.show_phone в baseline-миграции).

export const BUSINESS_ACCOUNT_TYPES = Object.freeze(["agency", "developer", "realtor"]);

export function isBusinessAccountType(accountType) {
  return BUSINESS_ACCOUNT_TYPES.includes(accountType);
}

/**
 * @param {{ account_type?: string, show_phone?: boolean } | null | undefined} user — строка users
 * @param {{ show_phone?: boolean, showPhone?: boolean } | null | undefined} [profile] — строка user_profiles
 */
export function canShowPublicPhone(user, profile) {
  if (!user) return false;
  if (isBusinessAccountType(user.account_type)) return true;
  return (
    user.show_phone === true ||
    profile?.show_phone === true ||
    profile?.showPhone === true
  );
}

export function getPublicPhone(user, profile) {
  return canShowPublicPhone(user, profile) ? (user?.phone || null) : null;
}
