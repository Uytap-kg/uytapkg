"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, CreditCard, Image, Scale, ArrowUpRight } from "lucide-react";

import { getAdminStats } from "@/utils/api";
import styles from "./Admin.module.css";
import StatCard from "./components/StatCard/StatCard";
import Header from "./components/Header/Header";
import Sidebar from "./components/Sidebar/Sidebar";

const sections = [
  {
    title: "Оплаты",
    description: "Тарифы, чеки и платежи",
    href: "/admin/payments",
    icon: CreditCard,
  },
  {
    title: "Баннеры",
    description: "Управление рекламными баннерами",
    href: "/admin/banners",
    icon: Image,
  },
  {
    title: "Юристы",
    description: "Добавление и управление юристами",
    href: "/admin/lawyers",
    icon: Scale,
  },
];

export default function AdminPage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("uytap_token");
    if (!token) return;

    getAdminStats(token)
      .then((res) => setStats(res.data))
      .catch((err) => {
        console.error("Error loading dashboard stats:", err);
        setError(err.message || "Не удалось загрузить статистику");
      });
  }, []);

  const statCards = [
    {
      title: "Новые пользователи",
      value: stats ? stats.newUsersCount.toLocaleString("ru-RU") : "—",
      icon: Users,
      // Тот же период, что и у счётчика на бэкенде (последние 30 дней)
      href: "/admin/users?period=30",
    },
    {
      title: "Оплаты",
      value: stats ? stats.paymentsCount.toLocaleString("ru-RU") : "—",
      icon: CreditCard,
    },
    {
      title: "Баннеры",
      value: stats ? stats.bannersCount.toLocaleString("ru-RU") : "—",
      icon: Image,
    },
    {
      title: "Юристы",
      value: stats ? stats.lawyersCount.toLocaleString("ru-RU") : "—",
      icon: Scale,
    },
  ];

  return (
    <div className={styles.admin}>
      <Sidebar />

      <div className={styles.content}>
        <Header
          title="Dashboard"
          subtitle="Обзор работы UYTap за последние 30 дней"
        />

        <main className={styles.main}>
          <section className={styles.period}>
            <div>
              <span>Период статистики</span>
              <strong>Последние 30 дней</strong>
            </div>
          </section>

          {error && <p style={{ color: "#e53e3e" }}>{error}</p>}

          <section className={styles.stats}>
            {statCards.map((stat) => (
              <StatCard key={stat.title} {...stat} />
            ))}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2>Управление</h2>
                <p>Основные разделы административной панели</p>
              </div>
            </div>

            <div className={styles.sectionGrid}>
              {sections.map((section) => {
                const Icon = section.icon;

                return (
                  <Link
                    key={section.title}
                    href={section.href}
                    className={styles.sectionItem}
                  >
                    <div className={styles.sectionIcon}>
                      <Icon />
                    </div>

                    <div className={styles.sectionInfo}>
                      <strong>{section.title}</strong>
                      <span>{section.description}</span>
                    </div>

                    <ArrowUpRight className={styles.arrow} />
                  </Link>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
