"use client";

import { useMemo, useState } from "react";
import {
  CreditCard,
  Search,
  Filter,
  CheckCircle2,
  Clock3,
  XCircle,
  AlertCircle,
  Eye,
  Download,
  LoaderCircle,
} from "lucide-react";

import styles from "./PricingHistory.module.css";
import CustomSelect from "@/components/ui/customSelect/CustomSelect";

const TARIFF_OPTIONS = [
  "Все тарифы",
  "СТАРТ",
  "ОПТИМАЛЬНЫЙ",
  "БИЗНЕС",
  "VIP-размещение",
  "Поднятие в ТОП",
  "Срочная публикация",
  "Instagram-продвижение",
];

const STATUS_CONFIG = {
  approved: {
    label: "Оплачено",
    icon: CheckCircle2,
    cls: "status_paid",
  },

  processing: {
    label: "Ожидает оплаты",
    icon: Clock3,
    cls: "status_pending",
  },

  pending: {
    label: "Ожидает оплаты",
    icon: Clock3,
    cls: "status_pending",
  },

  canceled: {
    label: "Отменён",
    icon: XCircle,
    cls: "status_canceled",
  },

  failed: {
    label: "Ошибка",
    icon: AlertCircle,
    cls: "status_canceled",
  },
};

const formatPrice = (price) => {
  if (price === null || price === undefined || price === "") {
    return "—";
  }

  return `${Number(price).toLocaleString("ru-RU")} сом`;
};

const formatDate = (value) => {
  if (!value) return "—";

  return new Date(value).toLocaleDateString("ru-RU");
};

export default function PaymentHistory({
  payments,
  loading,
  loadError,
  receiptData,
  isDownloading,
  receiptRef,
  onDownloadReceipt,
}) {
  const [search, setSearch] = useState("");
  const [tariffFilter, setTariffFilter] = useState("Все тарифы");
  const [selectedPayment, setSelectedPayment] = useState(null);

  const filteredPayments = useMemo(() => {
    const query = search.trim().toLowerCase();

    return payments.filter((payment) => {
      const matchesSearch =
        !query ||
        (payment.userEmail || "").toLowerCase().includes(query) ||
        (payment.userPhone || "").toLowerCase().includes(query) ||
        (payment.orderId || "").toLowerCase().includes(query);

      const matchesTariff =
        tariffFilter === "Все тарифы" || payment.tariffTitle === tariffFilter;

      return matchesSearch && matchesTariff;
    });
  }, [payments, search, tariffFilter]);

  return (
    <>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>История платежей</h2>

            <p>
              Всего: <b>{filteredPayments.length}</b>
            </p>
          </div>
        </div>

        {/* FILTERS */}

        <div className={styles.filters}>
          <div className={styles.search}>
            <Search />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по email, телефону, ID..."
            />
          </div>

          <div className={styles.customSelect}>
            <CustomSelect
              icon={Filter}
              title="Тариф"
              options={TARIFF_OPTIONS}
              value={tariffFilter}
              setValue={setTariffFilter}
            />
          </div>
        </div>

        {/* TABLE */}

        <div className={styles.tableWrapper}>
          {loading ? (
            <div className={styles.empty}>
              <LoaderCircle className={styles.spin} />

              <strong>Загружаем платежи...</strong>
            </div>
          ) : loadError ? (
            <div className={styles.empty}>
              <AlertCircle />

              <strong>Не удалось загрузить платежи</strong>

              <span>{loadError}</span>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Тариф</th>
                  <th>Сумма</th>
                  <th>Период</th>
                  <th>Дата</th>
                  <th>Чек</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filteredPayments.map((payment) => {
                  const status =
                    STATUS_CONFIG[payment.status] || STATUS_CONFIG.pending;

                  const StatusIcon = status.icon;

                  return (
                    <tr key={payment.orderId}>
                      {/* USER */}

                      <td>
                        <div className={styles.user}>
                          <div className={styles.avatar}>
                            {(payment.userEmail || "?").charAt(0).toUpperCase()}
                          </div>

                          <div>
                            <strong>{payment.userEmail || "—"}</strong>

                            <span>{payment.userPhone || ""}</span>
                          </div>
                        </div>
                      </td>

                      {/* TARIFF */}

                      <td>
                        <span className={styles.tariff}>
                          {payment.tariffTitle}
                        </span>

                        {payment.type === "promotion" && (
                          <span className={styles.tariffSub}>
                            {payment.listingTitle || "Объявление удалено"}
                          </span>
                        )}
                      </td>

                      {/* PRICE */}

                      <td>
                        <strong className={styles.price}>
                          {formatPrice(payment.amount)}
                        </strong>
                      </td>

                      {/* PERIOD */}

                      <td>
                        <div className={styles.period}>
                          <strong>
                            {payment.type === "promotion"
                              ? payment.serviceType === "instagram"
                                ? "разово"
                                : `${payment.days} дн.`
                              : `${payment.months} мес.`}
                          </strong>
                        </div>
                      </td>

                      {/* DATE */}

                      <td>
                        <span className={styles.date}>
                          {formatDate(payment.paidAt || payment.createdAt)}
                        </span>
                      </td>

                      {/* RECEIPT */}

                      <td>
                        <button
                          type="button"
                          className={styles.receiptButton}
                          onClick={() => setSelectedPayment(payment)}
                        >
                          <Eye />
                          Посмотреть
                        </button>
                      </td>

                      {/* STATUS */}

                      <td>
                        <span
                          className={`${styles.status} ${styles[status.cls]}`}
                        >
                          <StatusIcon />

                          {status.label}
                        </span>
                      </td>

                      {/* MORE */}

                      <td>
                        <button
                          type="button"
                          className={styles.moreButton}
                          onClick={() => setSelectedPayment(payment)}
                        >
                          <Eye />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!loading && !loadError && !filteredPayments.length && (
            <div className={styles.empty}>
              <CreditCard />

              <strong>Платежи не найдены</strong>

              <span>Попробуйте изменить параметры поиска.</span>
            </div>
          )}
        </div>
      </section>

      {/* PAYMENT DETAILS MODAL */}

      {selectedPayment && (
        <div
          className={styles.overlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedPayment(null);
            }
          }}
        >
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <span>Платёж</span>

                <h2>{selectedPayment.userEmail || "Пользователь"}</h2>
              </div>

              <button
                type="button"
                onClick={() => setSelectedPayment(null)}
                className={styles.modalClose}
              >
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalUser}>
                <div className={styles.modalAvatar}>
                  {(selectedPayment.userEmail || "?").charAt(0).toUpperCase()}
                </div>

                <div>
                  <strong>{selectedPayment.userEmail || "—"}</strong>

                  <span>{selectedPayment.userPhone || ""}</span>
                </div>
              </div>

              <div className={styles.detailsGrid}>
                <div>
                  <span>Тариф</span>
                  <strong>{selectedPayment.tariffTitle}</strong>
                </div>

                <div>
                  <span>Стоимость</span>
                  <strong>{formatPrice(selectedPayment.amount)}</strong>
                </div>

                <div>
                  <span>Период</span>

                  <strong>
                    {selectedPayment.type === "promotion"
                      ? selectedPayment.serviceType === "instagram"
                        ? "разово"
                        : `${selectedPayment.days} дн.`
                      : `${selectedPayment.months} мес.`}
                  </strong>
                </div>

                {selectedPayment.type === "promotion" && (
                  <div>
                    <span>Объявление</span>

                    <strong>
                      {selectedPayment.listingTitle || "Объявление удалено"}
                    </strong>
                  </div>
                )}

                {selectedPayment.type === "promotion" &&
                  selectedPayment.serviceType === "instagram" && (
                    <div>
                      <span>Публикация</span>

                      <strong>
                        {selectedPayment.fulfillmentStatus ===
                        "fulfillment_pending"
                          ? "Ожидает публикации"
                          : selectedPayment.fulfillmentStatus === "applied"
                            ? "Опубликовано"
                            : "—"}
                      </strong>
                    </div>
                  )}

                <div>
                  <span>ID платежа</span>
                  <strong>{selectedPayment.orderId}</strong>
                </div>

                <div>
                  <span>Дата</span>

                  <strong>
                    {formatDate(
                      selectedPayment.paidAt || selectedPayment.createdAt,
                    )}
                  </strong>
                </div>

                <div>
                  <span>Статус</span>

                  <strong>
                    {
                      (
                        STATUS_CONFIG[selectedPayment.status] ||
                        STATUS_CONFIG.pending
                      ).label
                    }
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
