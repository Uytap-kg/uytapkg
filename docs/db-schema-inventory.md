# Инвентаризация схемы базы данных UyTap (Database Schema Inventory)

> Настоящий документ фиксирует единый источник правды схемы PostgreSQL / Supabase, используемой сервисами и контроллерами бэкенда UyTap.
> Составлен по результатам статического анализа обращений через Supabase Client (`.from(...)`, `.rpc(...)`), прямых SQL-запросов (`queryPool(...)`), а также аудита миграций `supabase/migrations/` и `back-end/src/schema.sql`.

---

## 1. Реестр таблиц и используемых колонок

| Таблица | Колонки, используемые кодом | Назначение и контекст использования | Где используется в коде |
|---|---|---|---|
| **`users`** | `id`, `account_type`, `email`, `phone`, `password_hash`, `is_verified`, `show_phone`, `token_version`, `role`, `is_email_verified`, `created_at`, `updated_at` | Основная таблица пользователей и аутентификации. | `authController.js`, `auth.js`, `listingsController.js`, `adminController.js`, `developersController.js`, `paymentsController.js`, `subscriptionsService.js` |
| **`user_profiles`** | `id`, `user_id`, `first_name`, `last_name`, `company_name`, `inn`, `office_address`, `about`, `avatar_url`, `created_at`, `updated_at` | Профили пользователей (физлица, риелторы, агентства, застройщики). | `authController.js`, `listingsController.js`, `developersController.js`, `complexesController.js`, `instagramRequests.js` |
| **`verification_requests`** | `id`, `user_id`, `passport_front`, `passport_back`, `status`, `reject_reason`, `created_at`, `updated_at` | Заявки продавцов на верификацию личности/паспорта. | `authController.js`, `adminController.js` |
| **`listings`** | `id`, `user_id`, `title`, `description`, `property_type`, `deal_type`, `rent_period`, `region`, `city`, `district`, `microdistrict`, `address`, `latitude`, `longitude`, `price`, `currency`, `area`, `rooms`, `floor`, `total_floors`, `is_resort`, `resort_filters`, `features`, `status`, `promotion_status`, `promotion_expires_at`, `is_urgent`, `urgent_expires_at`, `priority_rank`, `photos_count`, `views_count`, `expires_at`, `created_at`, `updated_at` | Каталог объявлений недвижимости. | `listingsController.js`, `cronService.js`, `promotionsService.js`, `subscriptionsService.js`, `paymentsController.js`, `adminController.js`, `complexesController.js`, `favoritesController.js`, `instagramRequests.js` |
| **`listing_photos`** | `id`, `listing_id`, `url`, `is_main`, `display_order`, `created_at` | Фотографии объявлений. | `listingsController.js`, `instagramRequests.js` |
| **`developers`** | `id`, `user_id`, `company_name`, `logo_url`, `description`, `phone`, `email`, `website`, `registry_url`, `is_verified`, `created_at` | Профили компаний-застройщиков. | `authController.js`, `developersController.js`, `complexesController.js` |
| **`residential_complexes`** | `id`, `developer_id`, `name`, `description`, `region`, `city`, `address`, `completion_status`, `completion_date`, `housing_class`, `registry_link`, `cover_photo`, `features`, `created_at` | Жилые комплексы (ЖК). | `complexesController.js`, `listingsController.js`, `developersController.js` |
| **`complex_layouts`** | `id`, `complex_id`, `title`, `rooms`, `area`, `price`, `status`, `image_url`, `created_at` | Планировки квартир в жилых комплексах. | `complexesController.js` |
| **`favorites`** | `id`, `user_id`, `listing_id`, `created_at` | Избранные объявления пользователей. | `favoritesController.js` |
| **`banners`** | `id`, `title`, `image_url`, `link_url`, `is_active`, `views_count`, `clicks_count`, `image_position_x`, `image_position_y`, `start_date`, `end_date`, `created_at`, `updated_at` | Рекламные баннеры на главной странице. | `bannersController.js`, `bannersStore.js`, `adminController.js` |
| **`subscriptions`** | `id`, `user_id`, `tariff_id`, `started_at`, `expires_at`, `is_active`, `is_individual`, `custom_name`, `active_listings_limit`, `vip_boosts_limit`, `top_boosts_limit`, `listings_used`, `vip_boosts_used`, `top_boosts_used`, `granted_by`, `created_at`, `updated_at` | Активные подписки и тарифы пользователей. | `subscriptionsService.js`, `paymentsController.js`, `listingsController.js`, `adminController.js` |
| **`payments`** | `id`, `user_id`, `order_id`, `invoice_id`, `trans_id`, `tariff_id`, `months`, `amount`, `status`, `qr_url`, `paylink_url`, `link_app`, `provider_response`, `paid_at`, `fulfilled_at`, `fulfilling_at`, `fulfill_attempts`, `fulfill_error`, `created_at`, `updated_at` | Платежи через O!Dengi (подписки и продвижения). | `paymentsController.js`, `cronService.js`, `adminController.js` |
| **`email_verifications`** | `id`, `email`, `code`, `code_hash`, `type`, `attempts`, `expires_at`, `is_used`, `reset_completed`, `created_at` | OTP-коды подтверждения email и сброса паролей. | `authController.js` |
| **`promotion_orders`** | `order_id`, `user_id`, `listing_id`, `service_type`, `days`, `status`, `created_at`, `applied_at` | Реестр заказов разовых услуг продвижения карточек. | `promotionOrders.js`, `paymentsController.js`, `adminController.js` |
| **`upload_ownership`** | `object_path`, `user_id`, `uploaded_at` | Реестр владения загруженными файлами в Storage. | `uploadOwnership.js` |
| **`processed_subscription_payments`** | `payment_id`, `user_id`, `tariff_id`, `processed_at` | Реестр идемпотентности примененных платежей подписок. | `subscriptionsService.js` |
| **`processed_refund_operations`** | `operation_id`, `user_id`, `subscription_id`, `operation_type`, `processed_at` | Реестр идемпотентности возвратов слотов/бустов. | `subscriptionsService.js` |
| **`lawyers`** | `id`, `last_name`, `first_name`, `middle_name`, `specialization`, `experience`, `phone`, `whatsapp`, `description`, `is_active`, `created_at`, `updated_at` | Каталог юристов платформы. | `lawyersController.js`, `adminController.js` |
| **`tariff_plans`** | `id`, `price`, `price_mode`, `active_listings_limit`, `vip_boosts_limit`, `top_boosts_limit`, `updated_at` | Настройки стоимости и лимитов тарифных планов. | `pricingSettings.js`, `adminController.js` |
| **`service_prices`** | `id`, `price`, `updated_at` | Настройки цен разовых услуг (VIP, TOP, Urgent, Instagram). | `pricingSettings.js`, `adminController.js` |
| **`instagram_requests`** | `id`, `listing_id`, `user_id`, `status`, `created_at`, `published_at`, `updated_at`, `published_by`, `notes` | Заявки на публикацию в Instagram-аккаунте UyTap. | `instagramRequests.js`, `adminController.js`, `listingsController.js` |

---

## 2. Реестр хранимых функций (RPC) и триггеров

| RPC Функция / Триггер | Сигнатура и параметры | Описание логики | Где вызывается кодом |
|---|---|---|---|
| **`consume_otp_attempt`** | `p_id UUID` → `INT` | Атомарный инкремент попыток ввода OTP-кода ДО сверки хэша. Ограничивает до 5 попыток. | `authController.js` (`verifyOtp`, `verifyResetCode`) |
| **`increment_views`** | `listing_id UUID` → `INT` | Атомарный инкремент счётчика `views_count` в объявлении без race condition. | `listingsController.js` (`incrementListingViews`) |
| **`increment_banner_stat`** | `banner_id UUID, stat TEXT` → `VOID` | Атомарный инкремент просмотров (`view`/`views`) или кликов (`click`/`clicks`) баннера. | `bannersStore.js` (`incrementBannerStat`) |
| **`activate_subscription_atomic`** | `p_user_id UUID, p_tariff_id VARCHAR, p_days INT, p_payment_id VARCHAR` → `subscriptions` | Атомарная активация или pro-rata продление подписки с `pg_advisory_xact_lock` и проверкой `processed_subscription_payments`. | `subscriptionsService.js` (`activateSubscription`) |
| **`refund_tariff_listing_atomic`** | `p_user_id UUID, p_operation_id VARCHAR, p_subscription_id UUID` → `BOOLEAN` | Атомарное восстановление списанного слота объявления при сбое создания с фиксацией в `processed_refund_operations`. | `subscriptionsService.js` (`refundTariffListing`) |
| **`refund_tariff_boost_atomic`** | `p_user_id UUID, p_boost_type VARCHAR, p_operation_id VARCHAR, p_subscription_id UUID` → `BOOLEAN` | Атомарное восстановление списанного буста VIP/TOP при сбое с фиксацией в `processed_refund_operations`. | `subscriptionsService.js` (`refundTariffBoost`) |
| **`create_listing_with_limit`** | `p_user_id UUID, p_listing_data JSONB, p_limit INT` → `listings` | Атомарная публикация объявления с проверкой лимита пользователя под `pg_advisory_xact_lock`. | `listingsController.js` (`createListing`) |
| **`register_user`** | `p_account_type VARCHAR, p_email VARCHAR, p_phone VARCHAR, p_password_hash TEXT, p_profile_data JSONB` → `UUID` | Транзакционная регистрация: создание записи в `users`, связанного профиля в `user_profiles`, и при типе 'developer' — записи в `developers`. | `authController.js` (`register`) |
| **`reclaim_unverified_user`** | `p_user_id UUID, p_account_type VARCHAR, p_phone VARCHAR, p_password_hash TEXT, p_profile_data JSONB` → `UUID` | Транзакционная перезапись брошенного неподтвержденного аккаунта, профиля и разработчика. | `authController.js` (`register`) |
| **`trg_listing_priority_rank`** | `BEFORE INSERT OR UPDATE ON listings` | Автоматический пересчёт `priority_rank` (0=VIP, 1=Urgent, 2=Top, 3=Regular) на основании дат истечения. | Триггер на уровне БД |
| **`trg_listing_photos_count`** | `AFTER INSERT OR DELETE OR UPDATE ON listing_photos` | Автоматическая синхронизация счетчика `photos_count` в родительском объявлении. | Триггер на уровне БД |

---

## 3. Вызовы прямых SQL-запросов через `queryPool(...)`

Файл `back-end/src/config/db.js` конфигурирует подключение `pg.Pool` (`dbPool`) и экспортирует метод `queryPool(text, params)`.
- Если переменная `DATABASE_URL` задана, пул инициализируется с максимальным количеством соединений 20.
- Если `DATABASE_URL` не задана, метод `queryPool` выбрасывает исключение с понятным текстом (Graceful degradation).
- По умолчанию контроллеры работают через Supabase PostgREST клиент (`supabase.from(...)`), а `queryPool` предоставляет прямой доступ к пулу TCP соединений для ресурсоемких аналитических и служебных операций.

---

## 4. Сверка с миграциями Supabase (`supabase/migrations/`)

Сверенные миграции в репозитории:
1. `20261012120000_banners_extend.sql` — расширение колонок баннеров, даты, координаты кадрирования, RLS, функция `increment_banner_stat`.
2. `20261013000000_listing_priority_rank.sql` — добавление `priority_rank`, `photos_count`, триггеры пересчёта, индексы сортировки.
3. `20261013000001_search_indexes_and_cleanup.sql` — расширение `pg_trgm`, триграммные индексы поиска по гео-локациям.
4. `20261013000100_payment_fulfillment_lease.sql` — аренда (lease) `fulfilling_at` для защиты от параллельной выдачи услуг.
5. `20261013120000_baseline_reconcile.sql` — базовое приведение схемы к полному соответствию с бэкендом (все недостающие колонки, таблицы `promotion_orders`, `upload_ownership`, `tariff_plans`, `service_prices`, `instagram_requests`, RPC-функции атомарных операций).
6. `20261013120100_register_user_rpc.sql` — хранимые процедуры транзакционной регистрации `register_user` и `reclaim_unverified_user`.
