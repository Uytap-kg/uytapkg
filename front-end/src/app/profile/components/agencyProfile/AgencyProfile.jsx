"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

import {
  Building2,
  Pencil,
  Phone,
  MessageCircle,
  Heart,
  Home,
  CreditCard,
  LogOut,
  Mail,
  MapPin,
  Globe,
  User,
  Check,
} from "lucide-react";

import styles from "./AgencyProfile.module.css";
import AgencyEditModal from "./agencyEdit/AgencyEditModal";

import { useLanguage } from "@/context/LanguageContext";
import { logout as authLogout } from "@/utils/auth";
import Header from "@/components/pageComponents/header/Header";

export default function AgencyProfile({
  user,
  adsCount = 0,
  favoritesCount = 0,
}) {
  const { t } = useLanguage();

  const [openEdit, setOpenEdit] = useState(false);

  if (!user) return null;

  const profile = user.profile || {};

  const logoUrl =
    profile.avatar_url ||
    profile.logo_url ||
    profile.avatar ||
    user.avatar_url ||
    user.avatar ||
    "/assets/AgencyImage.png";

  const companyName =
    profile.company_name || t("agencyProfile.defaults.companyName");

  const director =
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim() ||
    t("agencyProfile.defaults.director");

  const phone = user.phone || "";
  const whatsappNumber = phone.replace(/\D/g, "");

  const website = profile.website || "";
  const officeAddress = profile.office_address || "";
  const email = user.email || "";

  function logout() {
    authLogout();
    window.location.href = "/login";
  }

  return (
    <main className={styles.page}>
      <Header />

      <motion.section
        className={styles.profileCard}
        initial={{
          opacity: 0,
          y: 30,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        transition={{
          duration: 0.45,
          ease: "easeOut",
        }}
      >
        <div className={styles.topGlow} />

        {/* LOGO */}

        <div className={styles.logoWrapper}>
          <div className={styles.logo}>
            <img src={logoUrl} alt={companyName} />
          </div>
        </div>

        {/* INFO */}

        <div className={styles.info}>
          <div className={styles.heading}>
            <h1>{companyName}</h1>

            {user.isVerified && (
              <span
                className={styles.verified}
                title={t("agencyProfile.verified")}
              >
                <Check />
              </span>
            )}
          </div>

          <span className={styles.type}>
            <Building2 />
            {t("agencyProfile.type")}
          </span>

          <div className={styles.director}>
            <User />

            <span>
              {t("agencyProfile.director.label")} <strong>{director}</strong>
            </span>
          </div>

          <div className={styles.contacts}>
            {phone && (
              <div className={styles.contact}>
                <Phone />

                <span>{phone}</span>
              </div>
            )}

            {email && (
              <div className={styles.contact}>
                <Mail />

                <span>{email}</span>
              </div>
            )}

            {whatsappNumber && (
              <a
                href={`https://wa.me/${whatsappNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.contact} ${styles.whatsapp}`}
              >
                <MessageCircle />
                WhatsApp
              </a>
            )}
          </div>
        </div>

        {/* EDIT */}

        <button
          type="button"
          className={styles.edit}
          onClick={() => setOpenEdit(true)}
          aria-label={t("agencyProfile.actions.editAria")}
        >
          <Pencil />
        </button>
      </motion.section>

      {/* ABOUT */}

      <section className={styles.about}>
        <div className={styles.sectionTitle}>
          <Building2 />

          <h3>{t("agencyProfile.about.title")}</h3>
        </div>

        <p>{profile.about || t("agencyProfile.about.empty")}</p>
      </section>

      {/* COMPANY DETAILS */}

      {(officeAddress || website) && (
        <section className={styles.details}>
          {officeAddress && (
            <div className={styles.detail}>
              <div className={styles.detailIcon}>
                <MapPin />
              </div>

              <div>
                <span>{t("agencyProfile.details.office")}</span>

                <strong>{officeAddress}</strong>
              </div>
            </div>
          )}

          {website && (
            <a
              href={website.startsWith("http") ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.detail}
            >
              <div className={styles.detailIcon}>
                <Globe />
              </div>

              <div>
                <span>{t("agencyProfile.details.website")}</span>

                <strong>{website}</strong>
              </div>
            </a>
          )}
        </section>
      )}

      {/* STATS */}

      <section className={styles.stats}>
        <div className={styles.stat}>
          <strong>{adsCount}</strong>

          <span>{t("agencyProfile.stats.ads")}</span>
        </div>

        <div className={styles.stat}>
          <strong>{favoritesCount}</strong>

          <span>{t("agencyProfile.stats.favorites")}</span>
        </div>
      </section>

      {/* ACTIONS */}

      <section className={styles.actions}>
        <Link href="/profile/ads">
          <div className={styles.icon}>
            <Home />
          </div>

          <div>
            <h3>{t("agencyProfile.actions.myAds.title")}</h3>

            <p>{t("agencyProfile.actions.myAds.description")}</p>
          </div>
        </Link>

        <Link href="/favorites">
          <div className={styles.icon}>
            <Heart />
          </div>

          <div>
            <h3>{t("agencyProfile.actions.favorites.title")}</h3>

            <p>{t("agencyProfile.actions.favorites.description")}</p>
          </div>
        </Link>

        <Link href="/profile/tariff">
          <div className={styles.icon}>
            <CreditCard />
          </div>

          <div>
            <h3>{t("agencyProfile.actions.tariff.title")}</h3>

            <p>{t("agencyProfile.actions.tariff.description")}</p>
          </div>
        </Link>

        <button type="button" className={styles.logout} onClick={logout}>
          <div className={styles.icon}>
            <LogOut />
          </div>

          <div>
            <h3>{t("agencyProfile.actions.logout.title")}</h3>

            <p>{t("agencyProfile.actions.logout.description")}</p>
          </div>
        </button>
      </section>

      {/* EDIT MODAL */}

      {openEdit && (
        <AgencyEditModal user={user} close={() => setOpenEdit(false)} />
      )}
    </main>
  );
}
