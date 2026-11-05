import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import styles from "./StatCard.module.css";

// href — необязательный: если передан, карточка становится ссылкой
// на подробный раздел (например, «Новые пользователи» → /admin/users).
export default function StatCard({ title, value, change, icon: Icon, href }) {
  const content = (
    <>
      <div className={styles.top}>
        <div className={styles.icon}>
          <Icon />
        </div>

        <ArrowUpRight />
      </div>

      <span className={styles.title}>{title}</span>

      <div className={styles.bottom}>
        <strong>{value}</strong>
        <span>{change}</span>
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`${styles.card} ${styles.link}`}
        aria-label={`${title}: открыть подробный список`}
      >
        {content}
      </Link>
    );
  }

  return <div className={styles.card}>{content}</div>;
}
