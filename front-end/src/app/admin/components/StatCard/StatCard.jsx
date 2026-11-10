"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import styles from "./StatCard.module.css";

const DEFAULT_ROUTES = {
  "Новые пользователи": "/admin/users",
  Оплаты: "/admin/payments",
  Баннеры: "/admin/banners",
  Юристы: "/admin/lawyers",
};

export default function StatCard({ title, value, change, icon: Icon, href }) {
  const destination = href || DEFAULT_ROUTES[title] || "/admin";

  return (
    <Link
      href={destination}
      className={`${styles.card} ${styles.link}`}
      aria-label={`${title}: открыть раздел`}
    >
      <div className={styles.top}>
        <div className={styles.icon}>
          <Icon />
        </div>

        <ArrowUpRight />
      </div>

      <span className={styles.title}>{title}</span>

      <div className={styles.bottom}>
        <strong>{value}</strong>
        {change && <span>{change}</span>}
      </div>
    </Link>
  );
}
