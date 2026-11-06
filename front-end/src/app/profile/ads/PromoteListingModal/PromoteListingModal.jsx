"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Crown,
  Zap,
  Rocket,
  Camera,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

import { getPricing, promoteListingWithTariff } from "@/utils/api";
import { useLanguage } from "@/context/LanguageContext";

import styles from "./PromoteListingModal.module.css";

const SERVICES = [
  {
    id: "vip",
    icon: Crown,
    perDay: true,
  },
  {
    id: "top",
    icon: Rocket,
    perDay: true,
  },
  {
    id: "urgent",
    icon: Zap,
    perDay: true,
  },
  {
    id: "instagram",
    icon: Camera,
    perDay: false,
  },
];

const DAY_OPTIONS = [1, 3, 7, 14, 30];
const MAX_DAYS = 30;
const MIN_DAYS = 1;

const TARIFF_BOOSTABLE_SERVICES = ["vip", "top"];

export default function PromoteListingModal({
  isOpen,
  onClose,
  listing,
  onPromoted,
}) {
  const router = useRouter();
  const { t } = useLanguage();

  const [pricing, setPricing] = useState(null);
  const [pricingError, setPricingError] = useState("");
  const [serviceType, setServiceType] = useState("vip");
  const [days, setDays] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  /*
   * LOAD PRICING
   */

  useEffect(() => {
    if (!isOpen) return;

    setServiceType("vip");
    setDays(1);
    setPricing(null);
    setPricingError("");
    setSubmitting(false);

    getPricing()
      .then((data) => {
        setPricing(data);
      })
      .catch((err) => {
        console.error("Ошибка загрузки цен продвижения:", err);
        setPricingError("promoteListingModal.errors.pricing");
      });
  }, [isOpen]);

  /*
   * ESCAPE
   */

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !listing) {
    return null;
  }

  const selected =
    SERVICES.find((service) => service.id === serviceType) || SERVICES[0];

  const pricePerUnit = pricing?.services?.[serviceType];

  const total = pricing
    ? selected.perDay
      ? Number(pricePerUnit) * days
      : Number(pricePerUnit)
    : null;

  /*
   * TRANSLATIONS
   */

  const getServiceTitle = (serviceId) => {
    return t(`promoteListingModal.services.${serviceId}.title`);
  };

  const getServiceDescription = (serviceId) => {
    return t(`promoteListingModal.services.${serviceId}.description`);
  };

  const getServicePeriod = (service) => {
    return service.perDay
      ? t("promoteListingModal.pricing.perDay")
      : t("promoteListingModal.pricing.oneTime");
  };

  /*
   * DAYS
   */

  const updateDays = (value) => {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      setDays(MIN_DAYS);
      return;
    }

    setDays(Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.floor(parsed))));
  };

  /*
   * PAYMENT
   */

  const goToPayment = () => {
    const params = new URLSearchParams({
      type: "promotion",
      listingId: String(listing.id),
      serviceType,
    });

    if (selected.perDay) {
      params.set("days", String(days));
    }

    router.push(`/payment?${params.toString()}`);
  };

  /*
   * SUBMIT
   */

  const handleSubmit = async () => {
    if (submitting) return;

    /*
     * VIP и TOP сначала пытаемся списать
     * бесплатно из лимита тарифа.
     *
     * Срочно и Instagram всегда идут
     * через оплату.
     */

    if (!TARIFF_BOOSTABLE_SERVICES.includes(serviceType)) {
      goToPayment();
      return;
    }

    setSubmitting(true);

    try {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        goToPayment();
        return;
      }

      const result = await promoteListingWithTariff(token, listing.id, {
        serviceType,
        days,
      });

      if (result?.granted) {
        onPromoted?.();
        onClose();
        return;
      }

      goToPayment();
    } catch (error) {
      console.error("Ошибка проверки тарифа:", error);

      /*
       * Даже если проверка тарифа упала,
       * пользователь всё равно может перейти
       * к обычной оплате.
       */

      goToPayment();
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * RENDER
   */

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="promote-modal-title"
      >
        {/* HEADER */}

        <div className={styles.header}>
          <div>
            <span>{t("promoteListingModal.header.label")}</span>

            <h2 id="promote-modal-title">
              {t("promoteListingModal.header.title")}
            </h2>

            <p>{listing.title}</p>
          </div>

          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t("promoteListingModal.actions.close")}
          >
            <X />
          </button>
        </div>

        {/* BODY */}

        <div className={styles.body}>
          {pricingError && (
            <div className={styles.error}>
              <AlertCircle size={14} />

              {pricingError.startsWith("promoteListingModal.")
                ? t(pricingError)
                : pricingError}
            </div>
          )}

          {/* SERVICES */}

          <div className={styles.serviceGrid}>
            {SERVICES.map((service) => {
              const Icon = service.icon;
              const isSelected = serviceType === service.id;
              const price = pricing?.services?.[service.id];

              return (
                <button
                  key={service.id}
                  type="button"
                  className={`${styles.serviceCard} ${
                    isSelected ? styles.serviceSelected : ""
                  }`}
                  onClick={() => setServiceType(service.id)}
                >
                  <div className={styles.serviceIcon}>
                    <Icon size={19} />
                  </div>

                  <div className={styles.serviceInfo}>
                    <strong>{getServiceTitle(service.id)}</strong>

                    <span>{getServiceDescription(service.id)}</span>
                  </div>

                  <div className={styles.servicePrice}>
                    {price !== undefined ? (
                      <>
                        {Number(price).toLocaleString("ru-RU")}{" "}
                        {t("promoteListingModal.pricing.currency")}
                        <small>{getServicePeriod(service)}</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* DAYS */}

          {selected.perDay && (
            <div className={styles.daysSection}>
              <span className={styles.daysLabel}>
                {t("promoteListingModal.days.label")}
              </span>

              {/* QUICK OPTIONS */}

              <div className={styles.daysGrid}>
                {DAY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`${styles.dayOption} ${
                      days === option ? styles.dayOptionSelected : ""
                    }`}
                    onClick={() => setDays(option)}
                  >
                    {option === 30
                      ? "1 месяц"
                      : `${option} ${t("promoteListingModal.days.short")}`}
                  </button>
                ))}
              </div>

              {/* MANUAL COUNTER */}

              <div className={styles.daysCounter}>
                <button
                  type="button"
                  className={styles.daysCounterButton}
                  onClick={() => updateDays(days - 1)}
                  disabled={days <= MIN_DAYS}
                  aria-label="Уменьшить количество дней"
                >
                  −
                </button>

                <label className={styles.daysInputWrap}>
                  <span>Количество дней</span>

                  <input
                    type="number"
                    min={MIN_DAYS}
                    max={MAX_DAYS}
                    step="1"
                    value={days}
                    onChange={(event) => updateDays(event.target.value)}
                  />
                </label>

                <button
                  type="button"
                  className={styles.daysCounterButton}
                  onClick={() => updateDays(days + 1)}
                  disabled={days >= MAX_DAYS}
                  aria-label="Увеличить количество дней"
                >
                  +
                </button>
              </div>

              <p className={styles.daysHint}>
                Вы можете выбрать любой срок от 1 до 30 дней. Стоимость
                рассчитывается за каждый день продвижения.
              </p>
            </div>
          )}

          {/* INSTAGRAM */}

          {!selected.perDay && (
            <div className={styles.oneTimeInfo}>
              <strong>Разовая услуга</strong>
              <span>Оплата производится один раз, без выбора срока.</span>
            </div>
          )}
        </div>

        {/* FOOTER */}

        <div className={styles.footer}>
          <div className={styles.total}>
            <span>{t("promoteListingModal.total.label")}</span>

            <strong>
              {total !== null
                ? `${total.toLocaleString("ru-RU")} ${t(
                    "promoteListingModal.pricing.currency",
                  )}`
                : "—"}
            </strong>
          </div>

          <button
            type="button"
            className={styles.submit}
            onClick={handleSubmit}
            disabled={!pricing || submitting}
          >
            {submitting
              ? t("promoteListingModal.actions.checking")
              : t("promoteListingModal.actions.payment")}

            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
