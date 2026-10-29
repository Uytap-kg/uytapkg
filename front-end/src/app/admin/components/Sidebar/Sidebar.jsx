"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Image as ImageIcon,
  Scale,
  LogOut,
  Home,
  Camera,
  Monitor,
  Database,
  ChevronRight,
} from "lucide-react";

import styles from "./Sidebar.module.css";

const navigation = [
  {
    title: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    title: "Застройщики",
    href: "/admin/developers",
    icon: Building2,
  },
  {
    title: "Оплаты",
    href: "/admin/payments",
    icon: CreditCard,
  },
  {
    title: "Баннеры",
    href: "/admin/banners",
    icon: ImageIcon,
  },
  {
    title: "Instagram",
    href: "/admin/instagram",
    icon: Camera,
  },
  {
    title: "Юристы",
    href: "/admin/lawyers",
    icon: Scale,
  },
  {
    title: "Управление тарифами",
    href: "/admin/tarrifs",
    icon: Monitor,
  },
  {
    title: "Управление дефолтными тарифами",
    href: "/admin/defaultTarrifs",
    icon: Database,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem("uytap_token");
    localStorage.removeItem("uytap_user");

    document.cookie = "uytap_token=; path=/; max-age=0";

    router.push("/admin/login");
  };

  return (
    <aside className={styles.sidebar}>
      {/* LOGO */}
      <Link href="/admin" className={styles.logo}>
        <div className={styles.logoMark}>U</div>

        <div className={styles.logoText}>
          <strong>UYTap</strong>
          <span>ADMIN PANEL</span>
        </div>
      </Link>

      {/* NAVIGATION */}
      <nav className={styles.nav}>
        <span className={styles.label}>УПРАВЛЕНИЕ</span>

        <div className={styles.navList}>
          {navigation.map((item) => {
            const Icon = item.icon;

            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`${styles.link} ${active ? styles.active : ""}`}
              >
                <span className={styles.iconWrapper}>
                  <Icon size={19} strokeWidth={1.9} />
                </span>

                <span className={styles.linkText}>{item.title}</span>

                {active && (
                  <ChevronRight size={15} className={styles.activeArrow} />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* BOTTOM ACTIONS */}
      <div className={styles.bottom}>
        <Link href="/" className={styles.home}>
          <Home size={19} />
          <span>Открыть сайт</span>
        </Link>

        <button type="button" className={styles.logout} onClick={handleLogout}>
          <LogOut size={19} />
          <span>Выйти из аккаунта</span>
        </button>

        <div className={styles.footer}>
          <span className={styles.footerDot} />
          <span>UYTap Management</span>
          <span className={styles.version}>ADMIN</span>
        </div>
      </div>
    </aside>
  );
}
