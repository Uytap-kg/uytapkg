"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

import {
  ChevronDown,
  Heart,
  Flame,
  MapPin,
  Building2,
  Users,
  PlusCircle,
  LogIn,
  User,
  Menu,
  X,
  Globe2,
  ArrowRight,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";

import { getToken, logout } from "@/utils/auth";

import styles from "./Header.module.css";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher/LanguageSwitcher";

export default function Header() {
  const router = useRouter();
  const { t } = useLanguage();

  const [scrolled, setScrolled] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAuth, setIsAuth] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | AUTH
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const checkAuth = () => {
      const token = getToken();

      setIsAuth(Boolean(token));
    };

    /*
     * Первичная проверка.
     * Никакого getMe() здесь нет.
     * Поэтому Header определяется мгновенно.
     */
    checkAuth();

    /*
     * Login / Register / Logout
     */
    window.addEventListener("uytap:auth-changed", checkAuth);

    /*
     * Изменение localStorage из другой вкладки
     */
    window.addEventListener("storage", checkAuth);

    return () => {
      window.removeEventListener("uytap:auth-changed", checkAuth);

      window.removeEventListener("storage", checkAuth);
    };
  }, []);

  /*
  |--------------------------------------------------------------------------
  | SCROLL
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
      setOpenMenu(null);
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  /*
  |--------------------------------------------------------------------------
  | MOBILE BODY LOCK
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = previousOverflow;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  /*
  |--------------------------------------------------------------------------
  | MENU
  |--------------------------------------------------------------------------
  */

  function toggleMenu(menu) {
    setOpenMenu(openMenu === menu ? null : menu);
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
    setOpenMenu(null);
  }

  /*
  |--------------------------------------------------------------------------
  | PROTECTED ROUTES
  |--------------------------------------------------------------------------
  */

  function protectedRoute(path) {
    closeMobileMenu();

    /*
     * Токен — единственный источник истины.
     */
    const token = getToken();

    if (!token) {
      setIsAuth(false);

      router.push("/auth-required");
      return;
    }

    router.push(path);
  }

  /*
  |--------------------------------------------------------------------------
  | NORMAL NAVIGATION
  |--------------------------------------------------------------------------
  */

  function handleNavClick(path) {
    closeMobileMenu();

    router.push(path);
  }

  /*
  |--------------------------------------------------------------------------
  | LOGOUT
  |--------------------------------------------------------------------------
  */

  function handleLogout() {
    /*
     * Удаляет:
     * - uytap_token
     * - uytap_user
     * - доступные JS cookies
     *
     * И отправляет uytap:auth-changed.
     */
    logout();

    /*
     * Мгновенно меняем Header,
     * не ожидая никаких запросов.
     */
    setIsAuth(false);

    closeMobileMenu();

    /*
     * После выхода пользователь не должен
     * оставаться на защищенной странице.
     */
    router.replace("/auth-required");
  }

  return (
    <header className={`${styles.header} ${scrolled ? styles.scrolled : ""}`}>
      <div className={styles.container}>
        {/* =====================================================
            LOGO
        ====================================================== */}

        <Link href="/" className={styles.logo} onClick={closeMobileMenu}>
          <Image
            src={scrolled ? "/assets/logo.png" : "/assets/logo2.png"}
            width={140}
            height={80}
            alt="UyTap"
            priority
          />
        </Link>

        {/* =====================================================
            DESKTOP NAVIGATION
        ====================================================== */}

        <nav className={styles.nav}>
          {/* LOCATIONS */}

          <div className={styles.dropdown}>
            <button
              type="button"
              onClick={() => toggleMenu("location")}
              aria-expanded={openMenu === "location"}
            >
              <MapPin />

              {t("header.locations")}

              <ChevronDown />
            </button>

            {openMenu === "location" && (
              <div className={styles.menu}>
                <Link href="/issyk-kul" onClick={() => setOpenMenu(null)}>
                  Иссык-Куль
                </Link>

                <Link href="/search-map" onClick={() => setOpenMenu(null)}>
                  {t("header.searchOnMap")}
                </Link>
              </div>
            )}
          </div>

          {/* NEW BUILDINGS */}

          <div className={styles.dropdown}>
            <button
              type="button"
              onClick={() => toggleMenu("new")}
              aria-expanded={openMenu === "new"}
            >
              <Building2 />

              {t("header.newBuildings")}

              <ChevronDown />
            </button>

            {openMenu === "new" && (
              <div className={styles.menu}>
                <Link href="/complexes" onClick={() => setOpenMenu(null)}>
                  {t("header.residentialComplexes")}
                </Link>

                <Link href="/developers" onClick={() => setOpenMenu(null)}>
                  {t("header.developers")}
                </Link>
              </div>
            )}
          </div>

          {/* MORE */}

          <div className={styles.dropdown}>
            <button
              type="button"
              onClick={() => toggleMenu("more")}
              aria-expanded={openMenu === "more"}
            >
              <Users />

              {t("header.more")}

              <ChevronDown />
            </button>

            {openMenu === "more" && (
              <div className={styles.menu}>
                <Link href="/pricing" onClick={() => setOpenMenu(null)}>
                  {t("header.pricing")}
                </Link>

                <Link href="/all-products" onClick={() => setOpenMenu(null)}>
                  {t("header.allListings")}
                </Link>

                <Link href="/lawyers" onClick={() => setOpenMenu(null)}>
                  {t("header.lawyers")}
                </Link>
                
                <Link href="/realtors" onClick={() => setOpenMenu(null)}>
                  {t("header.realtors")}
                </Link>
              </div>
            )}
          </div>

          {/* FAVORITES */}

          <button
            type="button"
            className={styles.favorite}
            onClick={() => protectedRoute("/favorites")}
          >
            <Heart />

            {t("header.favorites")}
          </button>
        </nav>

        {/* =====================================================
            DESKTOP ACTIONS
        ====================================================== */}

        <div className={styles.actions}>
          <div className={styles.desktopLanguage}>
            <LanguageSwitcher />
          </div>

          <button
            type="button"
            className={styles.add}
            onClick={() => protectedRoute("/add-product")}
          >
            <PlusCircle />

            <span>{t("header.addListing")}</span>
          </button>

          <button
            type="button"
            className={styles.free}
            onClick={() => protectedRoute("/add-product")}
          >
            <Flame />

            <span>{t("header.freeListing")}</span>
          </button>

          {isAuth ? (
            <Link href="/profile" className={styles.login}>
              <User />

              <span>{t("header.profile")}</span>
            </Link>
          ) : (
            <Link href="/login" className={styles.login}>
              <LogIn />

              <span>{t("header.login")}</span>
            </Link>
          )}

          {/* BURGER */}

          <button
            type="button"
            className={styles.burgerButton}
            onClick={() => {
              setOpenMenu(null);
              setMobileMenuOpen(true);
            }}
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
          >
            <Menu />
          </button>
        </div>
      </div>

      {/* =====================================================
          MOBILE OVERLAY
      ====================================================== */}

      <div
        className={`${styles.mobileOverlay} ${
          mobileMenuOpen ? styles.open : ""
        }`}
        onClick={closeMobileMenu}
        aria-hidden="true"
      />

      {/* =====================================================
          MOBILE SIDEBAR
      ====================================================== */}

      <aside
        className={`${styles.mobileSidebar} ${
          mobileMenuOpen ? styles.open : ""
        }`}
        aria-hidden={!mobileMenuOpen}
      >
        {/* SIDEBAR HEADER */}

        <div className={styles.sidebarHeader}>
          <Link
            href="/"
            className={styles.sidebarLogo}
            onClick={closeMobileMenu}
          >
            <Image src="/assets/logo.png" width={120} height={70} alt="UyTap" />
          </Link>

          <button
            type="button"
            className={styles.closeButton}
            onClick={closeMobileMenu}
            aria-label="Close menu"
          >
            <X />
          </button>
        </div>

        <div className={styles.sidebarContent}>
          {/* =================================================
              ACCOUNT
          ================================================= */}

          <div className={styles.accountBlock}>
            <Link
              href={isAuth ? "/profile" : "/login"}
              className={styles.accountCard}
              onClick={closeMobileMenu}
            >
              <span className={styles.accountIcon}>
                {isAuth ? <User /> : <LogIn />}
              </span>

              <span className={styles.accountText}>
                <strong>
                  {isAuth ? t("header.profile") : t("header.login")}
                </strong>

                <small>
                  {isAuth ? t("header.profile") : t("header.login")}
                </small>
              </span>

              <ArrowRight className={styles.accountArrow} />
            </Link>

            <div className={styles.languageCard}>
              <div className={styles.languageIcon}>
                <Globe2 />
              </div>

              <div className={styles.languageLabel}>
                <strong>Language</strong>

                <small>Выберите язык</small>
              </div>

              <div className={styles.languageSwitcher}>
                <LanguageSwitcher />
              </div>
            </div>
          </div>

          {/* =================================================
              LOCATIONS
          ================================================= */}

          <div className={styles.sidebarSection}>
            <span className={styles.sidebarTitle}>{t("header.locations")}</span>

            <button type="button" onClick={() => handleNavClick("/issyk-kul")}>
              <MapPin />

              <span>Иссык-Куль</span>
            </button>

            <button type="button" onClick={() => handleNavClick("/search-map")}>
              <MapPin />

              <span>{t("header.searchOnMap")}</span>
            </button>
          </div>

          {/* =================================================
              NEW BUILDINGS
          ================================================= */}

          <div className={styles.sidebarSection}>
            <span className={styles.sidebarTitle}>
              {t("header.newBuildings")}
            </span>

            <button type="button" onClick={() => handleNavClick("/complexes")}>
              <Building2 />

              <span>{t("header.residentialComplexes")}</span>
            </button>

            <button type="button" onClick={() => handleNavClick("/developers")}>
              <Building2 />

              <span>{t("header.developers")}</span>
            </button>
          </div>

          {/* =================================================
              MORE
          ================================================= */}

          <div className={styles.sidebarSection}>
            <span className={styles.sidebarTitle}>{t("header.more")}</span>

            <button
              type="button"
              onClick={() => handleNavClick("/all-products")}
            >
              <Users />

              <span>{t("header.allListings")}</span>
            </button>

            <button type="button" onClick={() => handleNavClick("/pricing")}>
              <Users />

              <span>{t("header.pricing")}</span>
            </button>

            <button type="button" onClick={() => handleNavClick("/lawyers")}>
              <Users />

              <span>{t("header.lawyers")}</span>
            </button>

            <button type="button" onClick={() => protectedRoute("/favorites")}>
              <Heart />

              <span>{t("header.favorites")}</span>
            </button>
          </div>

          {/* =================================================
              ACTIONS
          ================================================= */}

          <div className={styles.sidebarActions}>
            <button
              type="button"
              className={styles.sidebarAdd}
              onClick={() => protectedRoute("/add-product")}
            >
              <PlusCircle />

              <span>{t("header.addListing")}</span>
            </button>

            <button
              type="button"
              className={styles.sidebarFree}
              onClick={() => protectedRoute("/add-product")}
            >
              <Flame />

              <span>{t("header.freeListing")}</span>
            </button>

            {isAuth && (
              <button
                type="button"
                className={styles.sidebarLogout}
                onClick={handleLogout}
              >
                <LogIn />

                <span>Выйти</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </header>
  );
}
