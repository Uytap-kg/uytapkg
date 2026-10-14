"use client";

import {
  Building2,
  Home,
  Trees,
  Car,
  Heart,
  MapPin,
  Phone,
  Mail,
  Search,
  UserRound,
  Smartphone,
  Laptop,
  ShieldCheck,
  FileText,
} from "lucide-react";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useLanguage } from "@/context/LanguageContext";
import logoImg from "../../../../public/assets/logo.png";

import styles from "./Footer.module.css";

const categories = [
  { key: "apartments", icon: Building2, value: "Квартира" },
  { key: "houses", icon: Home, value: "Дом" },
  { key: "land", icon: Trees, value: "Участок" },
  { key: "parking", icon: Car, value: "Паркинг/гараж" },
];

export default function Footer() {
  const router = useRouter();
  const { t } = useLanguage();

  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
    const checkAuth = () => {
      try {
        const token = localStorage.getItem("uytap_token");
        const storedUser = localStorage.getItem("uytap_user");

        setIsAuth(Boolean(token && storedUser));
      } catch {
        setIsAuth(false);
      }
    };

    checkAuth();

    window.addEventListener("storage", checkAuth);
    window.addEventListener("uytap:user-updated", checkAuth);

    return () => {
      window.removeEventListener("storage", checkAuth);
      window.removeEventListener("uytap:user-updated", checkAuth);
    };
  }, []);

  const protectedRoute = (path) => {
    if (!isAuth) {
      router.push("/auth-required");
      return;
    }

    router.push(path);
  };

  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        {/* BRAND AND CONTACTS */}
        <div className={styles.brand}>
          <Link href="/" className={styles.logo} aria-label="UyTap — главная">
            <Image src={logoImg} alt="UyTap" width={190} height={55} priority />
          </Link>

          <p className={styles.description}>{t("footer.brand.description")}</p>

          <div className={styles.contacts}>
            <a
              href="tel:+996553554541"
              className={styles.contactItem}
              aria-label="Позвонить по номеру 0553 55 45 41"
            >
              <Phone aria-hidden="true" />
              <span>0553 55 45 41</span>
            </a>

            <a
              href="mailto:uytap.official@gmail.com"
              className={styles.contactItem}
            >
              <Mail aria-hidden="true" />
              <span>uytap.official@gmail.com</span>
            </a>

            <div className={styles.contactItem}>
              <MapPin aria-hidden="true" />
              <span>{t("footer.location")}</span>
            </div>

            <div className={styles.contactItem}>
              <FileText aria-hidden="true" />
              <span>ИП Жолдошбекова Ж.С.</span>
            </div>
          </div>
        </div>

        {/* CATEGORIES */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>{t("footer.categories.title")}</h2>

          {categories.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.key}
                href={`/all-products?category=${encodeURIComponent(item.value)}`}
                className={styles.columnLink}
              >
                <Icon aria-hidden="true" />
                <span>{t(`footer.categories.items.${item.key}`)}</span>
              </Link>
            );
          })}

          <button
            type="button"
            className={styles.linkButton}
            onClick={() => protectedRoute("/favorites")}
          >
            <Heart aria-hidden="true" />
            <span>{t("footer.categories.favorites")}</span>
          </button>
        </div>

        {/* SERVICE */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>{t("footer.service.title")}</h2>

          <Link href="/about" className={styles.columnLink}>
            <Laptop aria-hidden="true" />
            <span>{t("footer.service.about")}</span>
          </Link>

          <Link href="/safety" className={styles.columnLink}>
            <ShieldCheck aria-hidden="true" />
            <span>{t("footer.service.safety")}</span>
          </Link>

          <Link href="/all-products" className={styles.columnLink}>
            <Search aria-hidden="true" />
            <span>{t("footer.service.search")}</span>
          </Link>

          <button
            type="button"
            className={styles.linkButton}
            onClick={() => protectedRoute("/profile")}
          >
            <UserRound aria-hidden="true" />
            <span>{t("footer.service.profile")}</span>
          </button>

          <button
            type="button"
            className={styles.linkButton}
            onClick={() => protectedRoute("/profile/ads")}
          >
            <FileText aria-hidden="true" />
            <span>{t("footer.service.myListings")}</span>
          </button>
        </div>

        {/* MOBILE APP */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>{t("footer.app.title")}</h2>

          <div className={styles.appBox}>
            <Smartphone aria-hidden="true" />

            <div className={styles.appContent}>
              <strong>
                <span>UyTap</span> {t("footer.app.onYourPhone")}
              </strong>

              <p>{t("footer.app.description")}</p>
            </div>
          </div>

          <a
            href="#"
            className={styles.playStore}
            onClick={(e) => e.preventDefault()}
            aria-label="Приложение UyTap в Google Play"
          >
            <div className={styles.playIcon} aria-hidden="true">
              ▶
            </div>

            <div className={styles.playStoreText}>
              <span>{t("footer.app.download")}</span>
              <strong>Google Play</strong>
            </div>
          </a>
        </div>
      </div>

      {/* COPYRIGHT */}
      <div className={styles.bottom}>
        <p>
          © {new Date().getFullYear()} UyTap. {t("footer.copyright")}
        </p>

        <p className={styles.legalName}>ИП Жолдошбекова Ж.С.</p>
      </div>
    </footer>
  );
}
