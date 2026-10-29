"use client";

import { motion } from "framer-motion";
import Link from "next/link";

import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Home,
  MessageCircle,
  Phone,
  User,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import { mapListingData } from "@/utils/mapListingData";

import styles from "./PersonalPublicProfile.module.css";
import ListingCard from "@/components/ui/ListingCard/ListingCard";

export default function PersonalPublicProfile({
  user,
  favIds = new Set(),
  onFavoriteClick,
}) {
  const { t } = useLanguage();

  if (!user) return null;

  const profile = user.profile || {};

  // Тот же источник аватара, что и в личном профиле.
  const avatarUrl =
    profile.avatar_url ||
    profile.avatar ||
    user.avatar_url ||
    user.avatar ||
    null;

  // Тот же источник имени, что и в личном профиле.
  const fullName =
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim() ||
    t("personalProfile.defaults.user");

  // Тот же источник телефона.
  const phone = String(user.phone || profile.phone || "").trim();
  const whatsappNumber = phone.replace(/\D/g, "");

  const role =
    user.role || user.user_type || profile.role || profile.user_type || "user";

  const profileType = getProfileType(role, t);

  // Используем объявления, переданные вместе с пользователем.
  const ads = Array.isArray(user.ads)
    ? user.ads
    : Array.isArray(profile.ads)
      ? profile.ads
      : Array.isArray(profile.listings)
        ? profile.listings
        : Array.isArray(profile.properties)
          ? profile.properties
          : [];

  const favorites = favIds instanceof Set ? favIds : new Set();

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} />

      <div className={styles.container}>
        <Link href="/" className={styles.backButton}>
          <ArrowLeft size={17} />
          <span>{t("personalPublicProfile.topBar.home")}</span>
        </Link>

        {/* Публичная информация пользователя */}
        <motion.section
          className={styles.profileCard}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className={styles.profileAccent} />

          <div className={styles.profileTop}>
            <div className={styles.avatarWrapper}>
              <div className={styles.avatar}>
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={fullName}
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <User size={48} />
                )}
              </div>
            </div>

            <div className={styles.profileInfo}>
              <div className={styles.badge}>
                {profileType.icon}
                <span>{profileType.label}</span>
              </div>

              <h1>{fullName}</h1>

              <div className={styles.profileRole}>
                <span>{profileType.aboutTitle}</span>
              </div>

              {/* Контакты */}
              <div className={styles.contacts}>
                {phone ? (
                  <>
                    <div className={styles.phone}>
                      <Phone size={17} />
                      <span>{phone}</span>
                    </div>

                    {whatsappNumber && (
                      <a
                        href={`https://wa.me/${whatsappNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.whatsapp}
                        aria-label="WhatsApp"
                      >
                        <MessageCircle size={17} />
                        <span>WhatsApp</span>
                        <ArrowUpRight size={14} />
                      </a>
                    )}
                  </>
                ) : (
                  <p className={styles.noContact}>
                    {t("personalProfile.defaults.noPhone")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </motion.section>

        {/* Информация о пользователе */}
        <motion.section
          className={styles.aboutCard}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
        >
          <div className={styles.aboutHeader}>
            <span className={styles.aboutEyebrow}>
              {t("personalPublicProfile.about.profile")}
            </span>

            <h2>{profileType.aboutTitle}</h2>
          </div>

          <p>{profile.about || t("personalProfile.about.empty")}</p>
        </motion.section>

        {/* Публичные объявления пользователя */}
        <motion.section
          className={styles.listingsSection}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.14 }}
        >
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionEyebrow}>
                {t("personalPublicProfile.listings.title")}
              </span>

              <h2>{profileType.adsDescription}</h2>
            </div>

            <span className={styles.count}>{ads.length}</span>
          </div>

          {ads.length > 0 ? (
            <div className={styles.listingGrid}>
              {ads.map((item, index) => (
                <motion.div
                  key={item.id ?? item.ad_id ?? index}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: Math.min(index * 0.05, 0.3),
                  }}
                >
                  <ListingCard
                    item={mapListingData(item)}
                    isFavorite={favorites.has(item.id)}
                    onFavoriteClick={onFavoriteClick}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <Home size={25} />
              </div>

              <h3>{t("personalPublicProfile.empty.title")}</h3>

              <p>{t("personalPublicProfile.empty.description")}</p>
            </div>
          )}
        </motion.section>
      </div>
    </main>
  );
}

function getProfileType(role, t) {
  const normalized = String(role).toLowerCase().trim();

  if (
    normalized === "developer" ||
    normalized === "builder" ||
    normalized === "застройщик"
  ) {
    return {
      label: t("personalPublicProfile.roles.developer.label"),
      aboutTitle: t("personalPublicProfile.roles.developer.aboutTitle"),
      defaultAbout: t("personalPublicProfile.roles.developer.defaultAbout"),
      adsDescription: t("personalPublicProfile.roles.developer.adsDescription"),
      icon: <Building2 size={14} />,
    };
  }

  if (
    normalized === "agency" ||
    normalized === "real_estate_agency" ||
    normalized === "агентство"
  ) {
    return {
      label: t("personalPublicProfile.roles.agency.label"),
      aboutTitle: t("personalPublicProfile.roles.agency.aboutTitle"),
      defaultAbout: t("personalPublicProfile.roles.agency.defaultAbout"),
      adsDescription: t("personalPublicProfile.roles.agency.adsDescription"),
      icon: <Building2 size={14} />,
    };
  }

  if (
    normalized === "realtor" ||
    normalized === "agent" ||
    normalized === "риэлтор"
  ) {
    return {
      label: t("personalPublicProfile.roles.realtor.label"),
      aboutTitle: t("personalPublicProfile.roles.realtor.aboutTitle"),
      defaultAbout: t("personalPublicProfile.roles.realtor.defaultAbout"),
      adsDescription: t("personalPublicProfile.roles.realtor.adsDescription"),
      icon: <User size={14} />,
    };
  }

  return {
    label: t("personalPublicProfile.roles.personal.label"),
    aboutTitle: t("personalPublicProfile.roles.personal.aboutTitle"),
    defaultAbout: t("personalPublicProfile.roles.personal.defaultAbout"),
    adsDescription: t("personalPublicProfile.roles.personal.adsDescription"),
    icon: <User size={14} />,
  };
}
