"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  FileCheck2,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
  Sparkles,
  XCircle,
  Minus,
  Plus,
  CalendarDays,
} from "lucide-react";

import styles from "./Payment.module.css";
import PaymentReceiptModal from "./PaymentReceiptModal/PaymentReceiptModal";

import {
  createPayment,
  createPromotionPayment,
  getPaymentStatus,
  cancelPayment,
} from "@/utils/api";

const POLL_INTERVAL_MS = 3000;
const MIN_DAYS = 1;
const MAX_DAYS = 30;

const DAY_OPTIONS = [1, 3, 7, 14, 30];

export default function PaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const type =
    searchParams.get("type") === "promotion" ? "promotion" : "tariff";

  const tariffId = searchParams.get("tariffId");
  const months = Number(searchParams.get("months") || 1);

  const listingId = searchParams.get("listingId");
  const serviceType = searchParams.get("serviceType");

  const isPromotion = type === "promotion";
  const isInstagram = serviceType === "instagram";

  const backHref = isPromotion ? "/profile/ads" : "/pricing";

  // Для продвижения по умолчанию 1 день
  const [selectedDays, setSelectedDays] = useState(1);

  // selecting -> выбор периода | loading -> создание платежа
  // ready -> QR-код | error -> ошибка
  const [loadState, setLoadState] = useState(
    isPromotion ? "selecting" : "loading",
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [payment, setPayment] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Запуск автоматической проверки статуса платежа
  const startPolling = useCallback(
    (token, orderId) => {
      stopPolling();

      pollRef.current = setInterval(async () => {
        try {
          const fresh = await getPaymentStatus(token, orderId);

          setPayment((prev) => (prev ? { ...prev, ...fresh } : fresh));

          if (fresh.status === "approved") {
            setShowReceipt(true);
            stopPolling();
          } else if (fresh.status === "canceled" || fresh.status === "failed") {
            stopPolling();
          }
        } catch (error) {
          console.error("Ошибка проверки статуса платежа:", error);
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  // Инициализация страницы
  useEffect(() => {
    const token = localStorage.getItem("uytap_token");

    if (!token) {
      router.replace("/auth-required");
      return undefined;
    }

    // Продвижение: сначала пользователь выбирает период
    if (isPromotion) {
      if (!listingId || !serviceType) {
        setLoadState("error");
        setErrorMessage(
          "Не удалось определить объявление или услугу продвижения. Вернитесь в «Мои объявления».",
        );
        return undefined;
      }

      setLoadState("selecting");

      return undefined;
    }

    // Обычная оплата тарифа
    if (!tariffId || !months) {
      setLoadState("error");
      setErrorMessage(
        "Не удалось определить тариф. Вернитесь на страницу тарифов.",
      );

      return undefined;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const data = await createPayment(token, {
          tariffId,
          months,
        });

        if (cancelled) return;

        setPayment(data);
        setLoadState("ready");

        if (data.status === "approved") {
          setShowReceipt(true);
          return;
        }

        startPolling(token, data.orderId);
      } catch (error) {
        if (cancelled) return;

        setLoadState("error");
        setErrorMessage(
          error.message || "Не удалось создать платёж. Попробуйте позже.",
        );
      }
    };

    init();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [
    isPromotion,
    listingId,
    serviceType,
    tariffId,
    months,
    router,
    startPolling,
    stopPolling,
  ]);

  // Изменение количества дней
  const handleDaysChange = (value) => {
    const number = Number(value);

    if (!Number.isFinite(number)) return;

    setSelectedDays(Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.floor(number))));
  };

  const handleDecreaseDays = () => {
    setSelectedDays((prev) => Math.max(MIN_DAYS, prev - 1));
  };

  const handleIncreaseDays = () => {
    setSelectedDays((prev) => Math.min(MAX_DAYS, prev + 1));
  };

  // Создание платежа за продвижение после выбора периода
  const handleStartPromotionPayment = async () => {
    if (!isPromotion || loadState === "loading") return;

    const token = localStorage.getItem("uytap_token");

    if (!token) {
      router.replace("/auth-required");
      return;
    }

    if (!listingId || !serviceType) {
      setLoadState("error");
      setErrorMessage(
        "Не удалось определить объявление или услугу продвижения.",
      );
      return;
    }

    const days = isInstagram ? 1 : selectedDays;

    setLoadState("loading");
    setErrorMessage("");

    try {
      const data = await createPromotionPayment(token, {
        listingId,
        serviceType,
        days,
      });

      setPayment(data);
      setLoadState("ready");

      if (data.status === "approved") {
        setShowReceipt(true);
        return;
      }

      startPolling(token, data.orderId);
    } catch (error) {
      setLoadState("error");
      setErrorMessage(
        error.message || "Не удалось создать платёж. Попробуйте позже.",
      );
    }
  };

  const copyPaymentId = async () => {
    if (!payment) return;

    try {
      await navigator.clipboard.writeText(payment.orderId);
      setCopied(true);

      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleCancel = async () => {
    if (!payment || canceling) return;

    const token = localStorage.getItem("uytap_token");

    setCanceling(true);

    try {
      await cancelPayment(token, payment.orderId);
    } catch (error) {
      console.error("Ошибка отмены платежа:", error);
    } finally {
      stopPolling();
      router.push(backHref);
    }
  };

  const formatMoney = (value) => {
    return `${Number(value || 0).toLocaleString("ru-RU")} сом`;
  };

  const getMonthsText = (value) => {
    if (value === 1) return "месяц";
    if (value >= 2 && value <= 4) return "месяца";
    return "месяцев";
  };

  const pluralDays = (n) => {
    const mod10 = n % 10;
    const mod100 = n % 100;

    if (mod10 === 1 && mod100 !== 11) return "день";

    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return "дня";
    }

    return "дней";
  };

  const paymentData = payment
    ? isPromotion
      ? {
          heading: "Оплата продвижения",
          tariffLabel: "Услуга",
          tariff: `${
            payment.serviceTitle || payment.tariffId
          } — ${payment.listingTitle || "объявление"}`,
          priceLabel: isInstagram ? "Стоимость" : "Стоимость / день",
          price: payment.pricePerUnit ?? payment.amount,
          periodLabel: isInstagram
            ? "1 раз"
            : `${payment.days ?? selectedDays} ${pluralDays(
                payment.days ?? selectedDays,
              )}`,
          discount: 0,
          total: payment.amount,
          paymentId: payment.orderId,
          date: payment.paidAt ? new Date(payment.paidAt) : new Date(),
        }
      : {
          tariff: payment.tariffTitle || payment.tariffId,
          price: payment.pricePerMonth ?? payment.amount,
          months: payment.months,
          discount: payment.discountPercent || 0,
          total: payment.amount,
          paymentId: payment.orderId,
          date: payment.paidAt ? new Date(payment.paidAt) : new Date(),
        }
    : null;

  const isPending =
    payment &&
    (payment.status === "pending" || payment.status === "processing");

  const isApproved = payment?.status === "approved";

  const isCanceled =
    payment?.status === "canceled" || payment?.status === "failed";

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} />

      <header className={styles.header}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => router.back()}
        >
          <ArrowLeft size={17} />
          Назад
        </button>

        <div className={styles.logo}>
          Uy<span>Tap</span>
        </div>

        <div className={styles.secure}>
          <ShieldCheck size={16} />
          Безопасная оплата
        </div>
      </header>

      <section className={styles.container}>
        {/* ВЫБОР ПРОДОЛЖИТЕЛЬНОСТИ */}

        {loadState === "selecting" && isPromotion && (
          <div className={styles.selectionCard}>
            <div className={styles.selectionHeader}>
              <div className={styles.selectionIcon}>
                <CalendarDays size={22} />
              </div>

              <div>
                <span className={styles.selectionEyebrow}>UyTap Promotion</span>

                <h1>Продолжительность продвижения</h1>

                <p>
                  Выберите, на какой период вы хотите продвинуть своё
                  объявление.
                </p>
              </div>
            </div>

            {isInstagram ? (
              <div className={styles.oneTimeService}>
                <div className={styles.oneTimeIcon}>
                  <Sparkles size={21} />
                </div>

                <div>
                  <strong>Разовая услуга</strong>

                  <span>1 публикация — 1 раз</span>
                </div>

                <Check size={20} />
              </div>
            ) : (
              <>
                <div className={styles.periodLabel}>Быстрый выбор</div>

                <div className={styles.dayOptions}>
                  {DAY_OPTIONS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={`${styles.dayOption} ${
                        selectedDays === day ? styles.dayOptionActive : ""
                      }`}
                      onClick={() => setSelectedDays(day)}
                    >
                      <strong>
                        {day === 30 ? "1 месяц" : `${day} ${pluralDays(day)}`}
                      </strong>

                      {day === 1 && <span>Разово</span>}

                      {day === 30 && <span>30 дней</span>}
                    </button>
                  ))}
                </div>

                <div className={styles.customDays}>
                  <div className={styles.customDaysHeader}>
                    <strong>Своё количество дней</strong>

                    <span>От 1 до 30 дней</span>
                  </div>

                  <div className={styles.daysCounter}>
                    <button
                      type="button"
                      onClick={handleDecreaseDays}
                      disabled={selectedDays <= MIN_DAYS}
                      aria-label="Уменьшить количество дней"
                    >
                      <Minus size={19} />
                    </button>

                    <div className={styles.daysValue}>
                      <input
                        type="number"
                        min={MIN_DAYS}
                        max={MAX_DAYS}
                        value={selectedDays}
                        onChange={(event) =>
                          handleDaysChange(event.target.value)
                        }
                      />

                      <span>{pluralDays(selectedDays)}</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleIncreaseDays}
                      disabled={selectedDays >= MAX_DAYS}
                      aria-label="Увеличить количество дней"
                    >
                      <Plus size={19} />
                    </button>
                  </div>

                  <div className={styles.daysRange}>
                    <span>Минимум: 1 день</span>
                    <span>Максимум: 30 дней</span>
                  </div>
                </div>
              </>
            )}

            <div className={styles.selectionSummary}>
              <div>
                <span>Выбранный период</span>

                <strong>
                  {isInstagram
                    ? "1 раз"
                    : `${selectedDays} ${pluralDays(selectedDays)}`}
                </strong>
              </div>

              <Check size={20} />
            </div>

            <button
              type="button"
              className={styles.continuePayment}
              onClick={handleStartPromotionPayment}
            >
              Перейти к оплате
              <ArrowLeft size={18} style={{ transform: "rotate(180deg)" }} />
            </button>

            <p className={styles.selectionHint}>
              Сумма будет рассчитана автоматически на основании выбранной
              продолжительности и стоимости услуги.
            </p>
          </div>
        )}

        {/* СОЗДАНИЕ СЧЁТА */}

        {loadState === "loading" && (
          <div
            className={styles.qrCard}
            style={{ maxWidth: 420, margin: "0 auto" }}
          >
            <div className={styles.qrHeader}>
              <div className={styles.qrIcon}>
                <LoaderCircle size={20} className={styles.spin} />
              </div>

              <div>
                <h2>Создаём счёт</h2>
                <p>Подключаемся к O!Dengi...</p>
              </div>
            </div>
          </div>
        )}

        {/* ОШИБКА */}

        {loadState === "error" && (
          <div
            className={styles.qrCard}
            style={{ maxWidth: 420, margin: "0 auto" }}
          >
            <div className={styles.qrHeader}>
              <div className={styles.qrIcon}>
                <XCircle size={20} />
              </div>

              <div>
                <h2>Не удалось начать оплату</h2>
                <p>{errorMessage}</p>
              </div>
            </div>

            <button
              type="button"
              className={styles.actionButton}
              onClick={() => {
                if (isPromotion) {
                  setLoadState("selecting");
                } else {
                  router.push(backHref);
                }
              }}
            >
              {isPromotion
                ? "Вернуться к выбору периода"
                : "Вернуться к тарифам"}
            </button>
          </div>
        )}

        {/* ГОТОВЫЙ ПЛАТЁЖ */}

        {loadState === "ready" && payment && (
          <>
            <div className={styles.top}>
              <div>
                <div className={styles.badge}>
                  <Sparkles size={13} />

                  {isPromotion ? "Продвижение UyTap" : "UyTap PRO"}
                </div>

                <h1>{isPromotion ? "Оплата продвижения" : "Оплата тарифа"}</h1>

                <p>
                  Отсканируйте QR-код через приложение вашего банка. Сумма уже
                  указана в платеже.
                </p>
              </div>

              <div className={styles.paymentId}>
                <span>ID платежа</span>

                <button type="button" onClick={copyPaymentId}>
                  {payment.orderId}

                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            <div className={styles.paymentLayout}>
              {/* QR */}

              <section className={styles.qrCard}>
                <div className={styles.qrHeader}>
                  <div className={styles.qrIcon}>
                    <Smartphone size={20} />
                  </div>

                  <div>
                    <h2>Отсканируйте QR</h2>
                    <p>Откройте банковское приложение</p>
                  </div>
                </div>

                <div className={styles.qrWrapper}>
                  <div className={styles.qr}>
                    {payment.qrUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={payment.qrUrl}
                        alt="QR-код для оплаты"
                        width={250}
                        height={250}
                      />
                    ) : (
                      <div className={styles.qrSkeleton}>
                        <LoaderCircle size={28} />
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.amount}>
                  <span>К оплате</span>

                  <strong>{formatMoney(payment.amount)}</strong>
                </div>

                <div
                  className={`${styles.status} ${
                    isApproved
                      ? styles.statusSuccess
                      : isPending
                        ? styles.statusChecking
                        : ""
                  }`}
                >
                  {isApproved ? (
                    <>
                      <Check size={17} />
                      Оплата подтверждена
                    </>
                  ) : isCanceled ? (
                    <>
                      <XCircle size={17} />
                      Счёт отменён
                    </>
                  ) : (
                    <>
                      <Clock3 size={17} />
                      Ожидаем оплату
                    </>
                  )}
                </div>

                {isPending && (
                  <button
                    type="button"
                    className={styles.cancelLink}
                    onClick={handleCancel}
                    disabled={canceling}
                  >
                    {canceling ? "Отменяем..." : "Отменить платёж"}
                  </button>
                )}

                {isCanceled && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => router.push(backHref)}
                  >
                    {isPromotion
                      ? "Вернуться к объявлениям"
                      : "Вернуться к тарифам"}
                  </button>
                )}

                <p className={styles.hint}>
                  Статус оплаты обновляется автоматически, дополнительно
                  обновлять страницу не нужно.
                </p>
              </section>

              {/* SUMMARY */}

              <aside className={styles.summary}>
                <div className={styles.summaryHeader}>
                  <span>Ваш заказ</span>
                  <FileCheck2 size={18} />
                </div>

                <div className={styles.tariff}>
                  <div className={styles.tariffIcon}>
                    <Sparkles size={20} />
                  </div>

                  <div>
                    <span>{paymentData.tariffLabel || "Тариф"}</span>

                    <strong>{paymentData.tariff}</strong>
                  </div>
                </div>

                <div className={styles.details}>
                  <div>
                    <span>{paymentData.priceLabel || "Стоимость / месяц"}</span>

                    <strong>{formatMoney(paymentData.price)}</strong>
                  </div>

                  <div>
                    <span>Период</span>

                    <strong>
                      {paymentData.periodLabel ||
                        `${paymentData.months} ${getMonthsText(
                          paymentData.months,
                        )}`}
                    </strong>
                  </div>

                  {paymentData.discount > 0 && (
                    <div>
                      <span>Скидка</span>

                      <strong className={styles.discount}>
                        -{paymentData.discount}%
                      </strong>
                    </div>
                  )}
                </div>

                <div className={styles.total}>
                  <span>Итого</span>

                  <strong>{formatMoney(paymentData.total)}</strong>
                </div>

                <div className={styles.info}>
                  <ShieldCheck size={17} />

                  <p>
                    {isPromotion
                      ? isInstagram
                        ? "После подтверждения оплаты заявка на публикацию поступит нашей команде."
                        : "После подтверждения оплаты продвижение будет применено к объявлению автоматически."
                      : "После подтверждения оплаты тариф будет активирован автоматически."}
                  </p>
                </div>
              </aside>
            </div>
          </>
        )}
      </section>

      {/* ЭЛЕКТРОННЫЙ ЧЕК */}

      {paymentData && (
        <PaymentReceiptModal
          open={showReceipt}
          paymentData={paymentData}
          onClose={() => setShowReceipt(false)}
          onProfile={() =>
            router.push(isPromotion ? "/profile/ads" : "/profile")
          }
          description={
            isPromotion
              ? isInstagram
                ? "Оплата получена, заявка передана нашей команде на публикацию. Ниже находится электронный чек."
                : "Продвижение успешно применено к объявлению. Ниже находится электронный чек."
              : undefined
          }
          profileButtonLabel={isPromotion ? "К моим объявлениям" : undefined}
        />
      )}
    </main>
  );
}
