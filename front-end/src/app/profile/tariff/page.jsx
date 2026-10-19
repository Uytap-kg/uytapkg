"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarRange,
  Crown,
  Home,
  Rocket,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import styles from "./Tariff.module.css";
import { getMySubscription } from "@/utils/api";
import Header from "@/components/pageComponents/header/Header";

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

export default function MyTariffPage() {
  const router = useRouter();
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("uytap_token");

    if (!token) {
      router.push("/auth-required");
      return;
    }

    getMySubscription(token)
      .then((data) => setSubscription(data))
      .catch((err) => {
        console.error("Ошибка загрузки тарифа:", err);
        setError(err.message || "Не удалось загрузить данные тарифа");
      })
      .finally(() => setLoading(false));
  }, [router]);

  const stats = subscription
    ? [
        {
          key: "activeListings",
          icon: Home,
          label: "Активные объявления",
          used: subscription.used.activeListings,
          limit: subscription.limits.activeListings,
        },
        {
          key: "vipBoosts",
          icon: Crown,
          label: "Поднятия в VIP",
          used: subscription.used.vipBoosts,
          limit: subscription.limits.vipBoosts,
        },
        {
          key: "topBoosts",
          icon: Rocket,
          label: "Поднятия в ТОП",
          used: subscription.used.topBoosts,
          limit: subscription.limits.topBoosts,
        },
      ]
    : [];

  return (
    <main className={styles.page}>
      <Header />
      <div className={styles.topBar}>
        <Link href="/profile" className={styles.homeButton}>
          <ArrowLeft />В профиль
        </Link>
      </div>

      {loading && <div className={styles.stateMessage}>Загрузка тарифа...</div>}

      {!loading && error && <div className={styles.stateMessage}>{error}</div>}

      {!loading && !error && subscription && (
        <>
          <motion.section
            className={styles.statusCard}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className={styles.topGlow} />

            <div className={styles.statusHeader}>
              <div className={styles.statusIcon}>
                {subscription.active ? <BadgeCheck /> : <ShieldAlert />}
              </div>

              <div className={styles.statusInfo}>
                <span
                  className={`${styles.statusBadge} ${
                    subscription.active
                      ? styles.badgeActive
                      : styles.badgeInactive
                  }`}
                >
                  {subscription.active ? "Тариф активен" : "Тариф не активен"}
                </span>

                <h1>
                  {subscription.active
                    ? subscription.tariffName
                    : "Бесплатный доступ"}
                </h1>

                {subscription.active && (
                  <p className={styles.period}>
                    <CalendarRange size={15} />
                    {formatDate(subscription.startedAt)} —{" "}
                    {formatDate(subscription.expiresAt)}
                  </p>
                )}

                {!subscription.active && (
                  <p className={styles.period}>
                    Оформите тариф, чтобы размещать больше объявлений и получать
                    бесплатные поднятия VIP/ТОП
                  </p>
                )}
              </div>

              <Link href="/pricing" className={styles.upgradeButton}>
                <Sparkles size={16} />
                {subscription.active ? "Сменить тариф" : "Выбрать тариф"}
              </Link>
            </div>
          </motion.section>

          <section className={styles.statsGrid}>
            {stats.map((stat) => {
              const Icon = stat.icon;
              const limit = stat.limit || 0;
              const used = stat.used || 0;
              const percent =
                limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
              const remaining = Math.max(limit - used, 0);

              return (
                <div key={stat.key} className={styles.statCard}>
                  <div className={styles.statHeader}>
                    <div className={styles.statIcon}>
                      <Icon size={19} />
                    </div>

                    <span>{stat.label}</span>
                  </div>

                  <div className={styles.statNumbers}>
                    <strong>{remaining}</strong>
                    <span>осталось из {limit}</span>
                  </div>

                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <span className={styles.statFootnote}>
                    Использовано {used} из {limit}
                  </span>
                </div>
              );
            })}
          </section>

          <section className={styles.helpNote}>
            <p>
              Поднятия VIP/ТОП по тарифу списываются, когда вы выбираете
              соответствующий тип размещения при публикации объявления —
              бесплатно, пока лимит не исчерпан. После этого можно купить
              отдельное поднятие или сменить тариф.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
