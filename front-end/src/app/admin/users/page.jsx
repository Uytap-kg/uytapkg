"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Users,
} from "lucide-react";

import { getAdminUsers } from "@/utils/api";
import Header from "../components/Header/Header";
import Sidebar from "../components/Sidebar/Sidebar";
import styles from "./Users.module.css";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

const PERIOD_OPTIONS = [
  { value: "all", label: "За всё время" },
  { value: "7", label: "Последние 7 дней" },
  { value: "30", label: "Последние 30 дней" },
  { value: "90", label: "Последние 90 дней" },
];

const ACCOUNT_TYPE_OPTIONS = [
  { value: "", label: "Все типы" },
  { value: "personal", label: "Частное лицо" },
  { value: "realtor", label: "Риелтор" },
  { value: "agency", label: "Агентство" },
  { value: "developer", label: "Застройщик" },
];

const ACCOUNT_TYPE_LABELS = Object.fromEntries(
  ACCOUNT_TYPE_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);

const VALID_PERIODS = new Set(PERIOD_OPTIONS.map((o) => o.value));
const VALID_ACCOUNT_TYPES = new Set(ACCOUNT_TYPE_OPTIONS.map((o) => o.value));

// Параметры из URL — только из белого списка, остальное игнорируем.
function readFilters(searchParams) {
  const period = searchParams.get("period");
  const accountType = searchParams.get("accountType");
  const page = parseInt(searchParams.get("page"), 10);

  return {
    period: VALID_PERIODS.has(period) ? period : "all",
    accountType: VALID_ACCOUNT_TYPES.has(accountType) ? accountType : "",
    search: (searchParams.get("search") || "").slice(0, 100),
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

function formatPhone(phone) {
  if (!phone) return "—";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("996")) {
    return `+996 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  return phone;
}

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UsersContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { period, accountType, search, page } = readFilters(searchParams);

  const [searchInput, setSearchInput] = useState(search);
  const [prevSearch, setPrevSearch] = useState(search);

  // Результат последнего запроса с ключом фильтров, для которых он получен.
  // loading вычисляется: ключ результата не совпадает с текущими фильтрами.
  const requestKey = `${page}|${search}|${accountType}|${period}`;
  const [result, setResult] = useState({
    key: null,
    users: [],
    pagination: null,
    error: "",
  });
  const loading = result.key !== requestKey;
  const { users, pagination, error } = result;

  // Синхронизация поля ввода, если URL сменился извне (назад/вперёд)
  if (prevSearch !== search) {
    setPrevSearch(search);
    setSearchInput(search);
  }

  // Фильтры хранятся в URL — ссылку с дашборда (?period=30) можно
  // открыть напрямую, а «назад» в браузере возвращает прежний фильтр.
  const updateFilters = useCallback(
    (patch) => {
      const next = { period, accountType, search, page, ...patch };
      const params = new URLSearchParams();
      if (next.period !== "all") params.set("period", next.period);
      if (next.accountType) params.set("accountType", next.accountType);
      if (next.search.trim()) params.set("search", next.search.trim());
      if (next.page > 1) params.set("page", String(next.page));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, period, accountType, search, page],
  );

  // Debounce поиска: запрос уходит после паузы в наборе
  useEffect(() => {
    if (searchInput.trim() === search.trim()) return undefined;
    const timer = setTimeout(() => {
      updateFilters({ search: searchInput, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search, updateFilters]);

  useEffect(() => {
    const token = localStorage.getItem("uytap_token");

    // Отменяем предыдущий запрос, чтобы устаревший ответ не перезаписал новый
    const controller = new AbortController();

    const request = token
      ? getAdminUsers(
          token,
          { page, limit: PAGE_SIZE, search, accountType, period },
          { signal: controller.signal },
        )
      : Promise.reject(new Error("Требуется авторизация администратора"));

    request
      .then(({ users: list, pagination: meta }) => {
        setResult({ key: requestKey, users: list, pagination: meta || null, error: "" });
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error("Error loading admin users:", err);
        setResult({
          key: requestKey,
          users: [],
          pagination: null,
          error: err.message || "Ошибка загрузки пользователей",
        });
      });

    return () => controller.abort();
  }, [requestKey, page, search, accountType, period]);

  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  return (
    <main className={styles.main}>
      <div className={styles.pageHeader}>
        <div>
          <h2>Пользователи</h2>
          <p>Все зарегистрированные пользователи платформы</p>
        </div>

        <div className={styles.counter}>
          <Users size={16} />
          Найдено: <span>{loading && !pagination ? "…" : total.toLocaleString("ru-RU")}</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            maxLength={100}
            placeholder="Поиск по ФИО, телефону или email"
            aria-label="Поиск пользователей"
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>

        <select
          className={styles.select}
          value={accountType}
          aria-label="Тип аккаунта"
          onChange={(e) => updateFilters({ accountType: e.target.value, page: 1 })}
        >
          {ACCOUNT_TYPE_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={period}
          aria-label="Период регистрации"
          onChange={(e) => updateFilters({ period: e.target.value, page: 1 })}
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && !loading && (
        <div className={styles.error} role="alert">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <div className={styles.tableCard}>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№</th>
                <th>ФИО / Название</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Тип аккаунта</th>
                <th>Верификация</th>
                <th>Дата регистрации</th>
              </tr>
            </thead>

            <tbody className={loading ? styles.loadingBody : undefined}>
              {users.map((user, index) => (
                <tr key={user.id}>
                  <td className={styles.muted}>{offset + index + 1}</td>
                  <td>
                    <div className={styles.nameCell}>
                      <strong>{user.name || "Без имени"}</strong>
                      {user.name && user.companyName && user.name !== user.companyName && (
                        <span>{user.companyName}</span>
                      )}
                      {user.role === "admin" && <span className={styles.adminBadge}>Админ</span>}
                    </div>
                  </td>
                  <td className={styles.nowrap}>{formatPhone(user.phone)}</td>
                  <td className={styles.email}>{user.email || "—"}</td>
                  <td>
                    <span className={styles.typeBadge}>
                      {ACCOUNT_TYPE_LABELS[user.accountType] || user.accountType || "—"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.status} ${user.isVerified ? styles.verified : styles.notVerified}`}
                    >
                      {user.isVerified ? "Подтверждён" : "Не подтверждён"}
                    </span>
                  </td>
                  <td className={styles.nowrap}>{formatDate(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading && users.length === 0 && (
            <div className={styles.state}>
              <Loader2 className={styles.spinIcon} size={22} />
              Загрузка пользователей…
            </div>
          )}

          {!loading && !error && users.length === 0 && (
            <div className={styles.state}>Пользователи не найдены</div>
          )}
        </div>

        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => updateFilters({ page: page - 1 })}
              aria-label="Предыдущая страница"
            >
              <ChevronLeft size={16} />
            </button>

            <span>
              Страница {page} из {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => updateFilters({ page: page + 1 })}
              aria-label="Следующая страница"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function UsersPage() {
  return (
    <div className={styles.page}>
      <Sidebar />

      <div className={styles.content}>
        <Header title="Пользователи" subtitle="Управление пользователями UYTap" />

        <Suspense
          fallback={
            <main className={styles.main}>
              <div className={styles.state}>
                <Loader2 className={styles.spinIcon} size={22} />
                Загрузка…
              </div>
            </main>
          }
        >
          <UsersContent />
        </Suspense>
      </div>
    </div>
  );
}
