"use client";

import { useState } from "react";

import {
  Pencil,
  Phone,
  MessageCircle,
  Globe,
  MapPin,
  Mail,
  Heart,
  Home,
  CreditCard,
  LogOut,
  Building2,
  CheckCircle,
  House,
} from "lucide-react";

import styles from "./RealtorProfile.module.css";

import RealtorEditModal from "./realtorEdit/RealtorEditModal";

import { useLanguage } from "@/context/LanguageContext";
import { logout as authLogout } from "@/utils/auth";
import Header from "@/components/pageComponents/header/Header";

export default function RealtorProfile({
  user,
  adsCount = 0,
  favoritesCount = 0,
}) {
  const { t } = useLanguage();

  const [edit, setEdit] = useState(false);

  if (!user) return null;

  const profile = user.profile || {};

  const avatarUrl =
    profile.avatar_url ||
    profile.avatar ||
    user.avatar_url ||
    user.avatar ||
    "/assets/realtorImage.png";

  const name =
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim() ||
    t("realtorProfile.defaults.realtor");

  const company = profile.company_name || t("realtorProfile.defaults.company");

  const whatsapp = user.phone?.replace(/\D/g, "");

  function logout() {
    authLogout();
    window.location.href = "/login";
  }

  return (
    <main className={styles.page}>
      <Header />
      <section className={styles.profileCard}>
        <div className={styles.glow} />

        <div className={styles.top}>
          <div className={styles.avatar}>
            <img src={avatarUrl} alt={name} />
          </div>

          <div className={styles.info}>
            <div className={styles.badge}>{t("realtorProfile.badge")}</div>

            <div className={styles.nameRow}>
              <h1>{name}</h1>

              {user.isVerified && <CheckCircle className={styles.verify} />}
            </div>

            <div className={styles.company}>
              <Building2 />

              {company}
            </div>

            <p className={styles.description}>
              {profile.about || t("realtorProfile.defaults.about")}
            </p>
          </div>

          <button
            className={styles.edit}
            onClick={() => setEdit(true)}
            aria-label={t("realtorProfile.actions.editAria")}
          >
            <Pencil />
          </button>
        </div>

        <div className={styles.contacts}>
          {user.phone && (
            <div className={styles.contactCard}>
              <Phone />

              <div>
                <small>{t("realtorProfile.contacts.phone")}</small>

                <strong>{user.phone}</strong>
              </div>
            </div>
          )}

          {user.email && (
            <div className={styles.contactCard}>
              <Mail />

              <div>
                <small>{t("realtorProfile.contacts.email")}</small>

                <strong>{user.email}</strong>
              </div>
            </div>
          )}

          {profile.office_address && (
            <div className={styles.contactCard}>
              <MapPin />

              <div>
                <small>{t("realtorProfile.contacts.office")}</small>

                <strong>{profile.office_address}</strong>
              </div>
            </div>
          )}

          {profile.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.contactCard}
            >
              <Globe />

              <div>
                <small>{t("realtorProfile.contacts.website")}</small>

                <strong>{profile.website}</strong>
              </div>
            </a>
          )}
        </div>

        {whatsapp && (
          <a
            href={`https://wa.me/${whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.whatsapp}
          >
            <MessageCircle />

            {t("realtorProfile.actions.whatsapp")}
          </a>
        )}
      </section>

      <section className={styles.stats}>
        <div>
          <strong>{adsCount}</strong>

          <span>{t("realtorProfile.stats.ads")}</span>
        </div>

        <div>
          <strong>{favoritesCount}</strong>

          <span>{t("realtorProfile.stats.favorites")}</span>
        </div>
      </section>

      <section className={styles.menu}>
        <a href="/">
          <House />

          {t("realtorProfile.menu.home")}
        </a>

        <a href="/profile/ads">
          <Home />

          {t("realtorProfile.menu.ads")}
        </a>

        <a href="/favorites">
          <Heart />

          {t("realtorProfile.menu.favorites")}
        </a>

        <a href="/profile/tariff">
          <CreditCard />

          {t("realtorProfile.menu.tariff")}
        </a>

        <button onClick={logout}>
          <LogOut />

          {t("realtorProfile.menu.logout")}
        </button>
      </section>

      {edit && <RealtorEditModal user={user} close={() => setEdit(false)} />}
    </main>
  );
}
