"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Phone,
  MessageCircle,
  ArrowRight,
  BriefcaseBusiness,
} from "lucide-react";

import styles from "./RealtorsPage.module.css";
import Header from "@/components/pageComponents/header/Header";
import { getRealtors } from "@/utils/api";
import { useLanguage } from "@/context/LanguageContext";

const DEFAULT_IMAGE = "/assets/realtorImage.png";
const PAGE_SIZE = 24;

export default function RealtorsPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const [realtors, setRealtors] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const controllerRef = useRef(null);

  const loadPage = useCallback(
    async (pageToLoad) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const isFirstPage = pageToLoad === 1;
      if (isFirstPage) setLoading(true);
      else setLoadingMore(true);
      setError("");

      try {
        const { data, pagination } = await getRealtors({
          page: pageToLoad,
          limit: PAGE_SIZE,
          signal: controller.signal,
        });

        setRealtors((prev) => {
          if (isFirstPage) return data;
          // Защита от дублей, если список сдвинулся между запросами страниц
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...data.filter((r) => !seen.has(r.id))];
        });
        setTotal(pagination?.total ?? data.length);
        setHasMore(Boolean(pagination?.hasMore));
        setPage(pageToLoad);
      } catch (err) {
        if (err.name !== "AbortError") {
          setError(
            err.message ||
              t("realtorsPage.errors.load", "Не удалось загрузить риэлторов"),
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    loadPage(1);
    return () => controllerRef.current?.abort();
  }, [loadPage]);

  const getWhatsAppLink = (phone, name) => {
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    if (!cleanPhone) return null;

    const message = encodeURIComponent(
      t(
        "realtorsPage.whatsappMessage",
        "Здравствуйте, {name}! Нашёл(ла) ваш профиль на UyTap.kg. Хотел(а) бы узнать подробнее о ваших предложениях.",
      ).replace("{name}", name),
    );

    return `https://wa.me/${cleanPhone}?text=${message}`;
  };

  const getFullName = (realtor) =>
    [realtor.firstName, realtor.lastName].filter(Boolean).join(" ") ||
    realtor.companyName ||
    t("realtorsPage.defaultName", "Риэлтор");

  const openProfile = (id) => {
    router.push(`/realtors/${encodeURIComponent(id)}`);
  };

  return (
    <main className={styles.container}>
      <Header />

      <section className={styles.hero}>
        <div className={styles.headerContent}>
          <span className={styles.eyebrow}>
            <BriefcaseBusiness size={15} />
            {t("realtorsPage.eyebrow", "НАШИ СПЕЦИАЛИСТЫ")}
          </span>

          <h1>{t("realtorsPage.title", "Найдите своего риэлтора")}</h1>

          <p>
            {t(
              "realtorsPage.subtitle",
              "Профессионалы недвижимости, готовые помочь вам найти идеальное жильё.",
            )}
          </p>
        </div>

        <div className={styles.counter}>
          <strong>{total}</strong>
          <span>{t("realtorsPage.counter", "риэлторов на платформе")}</span>
        </div>
      </section>

      <div className={styles.sectionTop}>
        <div>
          <h2>{t("realtorsPage.listTitle", "Все риэлторы")}</h2>
          <p>
            {t(
              "realtorsPage.listSubtitle",
              "Выберите специалиста и свяжитесь с ним напрямую",
            )}
          </p>
        </div>

        <span className={styles.results}>
          {total} {t("realtorsPage.specialists", "специалистов")}
        </span>
      </div>

      {loading ? (
        <div className={styles.message}>
          {t("realtorsPage.loading", "Загрузка риэлторов...")}
        </div>
      ) : error && realtors.length === 0 ? (
        <div className={styles.message}>{error}</div>
      ) : realtors.length === 0 ? (
        <div className={styles.message}>
          {t("realtorsPage.empty", "Пока нет зарегистрированных риэлторов.")}
        </div>
      ) : (
        <>
          <section className={styles.grid}>
            {realtors.map((realtor) => {
              const fullName = getFullName(realtor);
              const phone = realtor.phone || "";
              const whatsappLink = getWhatsAppLink(phone, fullName);

              return (
                <article
                  key={realtor.id}
                  className={styles.card}
                  onClick={() => openProfile(realtor.id)}
                >
                  <div className={styles.imageWrapper}>
                    <img
                      src={realtor.avatarUrl || DEFAULT_IMAGE}
                      alt={fullName}
                      className={styles.image}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = DEFAULT_IMAGE;
                      }}
                    />

                    <span className={styles.typeBadge}>
                      {t("realtorsPage.badge", "Риэлтор")}
                    </span>
                  </div>

                  <div className={styles.cardContent}>
                    <div className={styles.info}>
                      <h3>{fullName}</h3>

                      {phone && (
                        <div className={styles.phone}>
                          <Phone size={15} />
                          <span>{phone}</span>
                        </div>
                      )}
                    </div>

                    <div className={styles.actions}>
                      {whatsappLink && (
                        <a
                          href={whatsappLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.whatsapp}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MessageCircle size={17} />
                          WhatsApp
                        </a>
                      )}

                      <button
                        type="button"
                        className={styles.profileButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          openProfile(realtor.id);
                        }}
                      >
                        {t("realtorsPage.profile", "Профиль")}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          {error && <div className={styles.message}>{error}</div>}

          {hasMore && (
            <div className={styles.loadMoreWrapper}>
              <button
                type="button"
                className={styles.loadMore}
                disabled={loadingMore}
                onClick={() => loadPage(page + 1)}
              >
                {loadingMore
                  ? t("realtorsPage.loading", "Загрузка риэлторов...")
                  : t("realtorsPage.loadMore", "Показать ещё")}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
