"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

import {
  User,
  Pencil,
  Phone,
  MessageCircle,
  Heart,
  Home,
  CreditCard,
  LogOut,
  ArrowLeft,
} from "lucide-react";

import styles from "./PersonalProfile.module.css";

import ProfileEditModal from "./profileEdit/ProfileEditModal";

import { useLanguage } from "@/context/LanguageContext";
import { logout as authLogout } from "@/utils/auth";
import Header from "@/components/pageComponents/header/Header";

export default function PersonalProfile({
  user,
  adsCount = 0,
  favoritesCount = 0,
}) {
  const { t } = useLanguage();

  const [openEdit, setOpenEdit] = useState(false);

  if (!user) return null;

  const profile = user.profile || {};

  const avatarUrl =
    profile.avatar_url ||
    profile.avatar ||
    user.avatar_url ||
    user.avatar ||
    null;

  const fullName = `${profile.first_name || ""} ${
    profile.last_name || ""
  }`.trim();

  const whatsappNumber = user.phone?.replace(/\D/g, "") || "";

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
      >
        <div className={styles.topGlow} />

        <div className={styles.avatarWrapper}>
          <div className={styles.avatar}>
            {avatarUrl ? (
              <img src={avatarUrl} alt={t("personalProfile.avatarAlt")} />
            ) : (
              <User />
            )}
          </div>
        </div>

        <div className={styles.info}>
          <h1>{fullName || t("personalProfile.defaults.user")}</h1>

          <span className={styles.type}>{t("personalProfile.type")}</span>

          <div className={styles.contacts}>
            <div className={styles.phone}>
              <Phone />

              <span>{user.phone || t("personalProfile.defaults.noPhone")}</span>
            </div>

            {whatsappNumber && (
              <a
                href={`https://wa.me/${whatsappNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.whatsapp}
                aria-label={t("personalProfile.actions.whatsapp")}
              >
                <MessageCircle />

                {t("personalProfile.whatsapp")}
              </a>
            )}
          </div>
        </div>

        <button
          className={styles.edit}
          onClick={() => setOpenEdit(true)}
          aria-label={t("personalProfile.actions.editAria")}
        >
          <Pencil />
        </button>
      </motion.section>

      <section className={styles.about}>
        <h3>{t("personalProfile.about.title")}</h3>

        <p>{profile.about || t("personalProfile.about.empty")}</p>
      </section>

      <section className={styles.actions}>
        <Link href="/profile/ads">
          <div className={styles.icon}>
            <Home />
          </div>

          <div>
            <h3>{t("personalProfile.actions.myAds.title")}</h3>

            <p>{t("personalProfile.actions.myAds.description")}</p>
          </div>
        </Link>

        <Link href="/favorites">
          <div className={styles.icon}>
            <Heart />
          </div>

          <div>
            <h3>{t("personalProfile.actions.favorites.title")}</h3>

            <p>{t("personalProfile.actions.favorites.description")}</p>
          </div>
        </Link>

        <Link href="/profile/tariff">
          <div className={styles.icon}>
            <CreditCard />
          </div>

          <div>
            <h3>{t("personalProfile.actions.tariff.title")}</h3>

            <p>{t("personalProfile.actions.tariff.description")}</p>
          </div>
        </Link>

        <button className={styles.logout} onClick={logout}>
          <div className={styles.icon}>
            <LogOut />
          </div>

          <div>
            <h3>{t("personalProfile.actions.logout.title")}</h3>

            <p>{t("personalProfile.actions.logout.description")}</p>
          </div>
        </button>
      </section>

      {openEdit && (
        <ProfileEditModal user={user} close={() => setOpenEdit(false)} />
      )}
    </main>
  );
}
