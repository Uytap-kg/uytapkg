"use client";

import { motion } from "framer-motion";
import Link from "next/link";

import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle,
  Globe,
  Home,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import { mapListingData } from "@/utils/mapListingData";

import styles from "./RealtorPublicProfile.module.css";
import ListingCard from "@/components/ui/ListingCard/ListingCard";

export default function RealtorPublicProfile({
  user,
  favIds = new Set(),
  onFavoriteClick,
}) {
  const { t } = useLanguage();

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
    t("realtorPublicProfile.defaults.realtor");

  const company = profile.company_name || "";
  const phone = String(user.phone || profile.phone || "").trim();
  const email = String(user.email || profile.email || "").trim();
  const website = String(profile.website || "").trim();
  const officeAddress = String(profile.office_address || "").trim();

  const whatsapp = phone.replace(/\D/g, "");

  const ads = Array.isArray(user.ads)
    ? user.ads
    : Array.isArray(profile.ads)
      ? profile.ads
      : Array.isArray(profile.listings)
        ? profile.listings
        : Array.isArray(profile.properties)
          ? profile.properties
          : [];

  const adsCount = profile.ads_count ?? ads.length;

  const websiteUrl = website
    ? /^https?:\/\//i.test(website)
      ? website
      : `https://${website}`
    : "";

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} />
      <div className={styles.backgroundGlowTwo} />

      <div className={styles.container}>
        <Link href="/" className={styles.backButton}>
          <ArrowLeft size={17} />
          <span>{t("realtorPublicProfile.topBar.home")}</span>
        </Link>

        {/* Публичная информация риэлтора */}
        <motion.section
          className={styles.profileCard}
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className={styles.cardGlow} />

          <div className={styles.profileTop}>
            <motion.div
              className={styles.avatarColumn}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <div className={styles.avatarRing}>
                <div className={styles.avatar}>
                  <img src={avatarUrl} alt={name} />
                </div>
              </div>

              {user.isVerified && (
                <div className={styles.avatarVerified}>
                  <CheckCircle size={16} />
                  <span>{t("realtorPublicProfile.verification.profile")}</span>
                </div>
              )}
            </motion.div>

            <motion.div
              className={styles.info}
              initial={{ opacity: 0, x: 15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.12 }}
            >
              <div className={styles.topMeta}>
                <span className={styles.badge}>
                  <span className={styles.badgeDot} />
                  {t("realtorPublicProfile.role")}
                </span>

                {user.isVerified && (
                  <span className={styles.verifiedLabel}>
                    <CheckCircle size={15} />
                    {t("realtorPublicProfile.verification.short")}
                  </span>
                )}
              </div>

              <div className={styles.nameRow}>
                <h1>{name}</h1>
              </div>

              {company && (
                <div className={styles.company}>
                  <Building2 size={18} />
                  <span>{company}</span>
                </div>
              )}

              <p className={styles.description}>
                {profile.about || t("realtorPublicProfile.defaults.about")}
              </p>

              <div className={styles.actions}>
                {phone && (
                  <div className={styles.primaryAction}>
                    <Phone size={18} />
                    <span>{phone}</span>
                  </div>
                )}

                {whatsapp && (
                  <a
                    href={`https://wa.me/${whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.secondaryAction}
                    aria-label="WhatsApp"
                  >
                    <MessageCircle size={18} />
                    <span>WhatsApp</span>
                    <ArrowUpRight size={14} />
                  </a>
                )}

                {email && (
                  <a
                    href={`mailto:${email}`}
                    className={styles.secondaryAction}
                    aria-label="Email"
                  >
                    <Mail size={18} />
                    <span>Email</span>
                    <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            </motion.div>
          </div>

          {/* Дополнительные публичные данные */}
          {(officeAddress || websiteUrl) && (
            <div className={styles.details}>
              {officeAddress && (
                <div className={styles.detail}>
                  <div className={styles.detailIcon}>
                    <MapPin size={19} />
                  </div>

                  <div className={styles.detailContent}>
                    <span>{t("realtorPublicProfile.details.office")}</span>
                    <strong>{officeAddress}</strong>
                  </div>
                </div>
              )}

              {websiteUrl && (
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.detail}
                >
                  <div className={styles.detailIcon}>
                    <Globe size={19} />
                  </div>

                  <div className={styles.detailContent}>
                    <span>{t("realtorPublicProfile.details.website")}</span>
                    <strong>
                      {website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                    </strong>
                  </div>

                  <ArrowUpRight className={styles.detailArrow} />
                </a>
              )}
            </div>
          )}
        </motion.section>

        {/* Количество объявлений — без личной статистики */}
        <motion.section
          className={styles.stats}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <div className={styles.statCard}>
            <div className={styles.statIcon}>
              <Home size={21} />
            </div>

            <div>
              <strong>{adsCount}</strong>
              <span>{t("realtorPublicProfile.stats.activeAds")}</span>
            </div>
          </div>
        </motion.section>

        {/* Публичные объявления риэлтора */}
        <motion.section
          className={styles.listingsSection}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2 }}
        >
          <div className={styles.sectionHeader}>
            <div>
              <span>{t("realtorPublicProfile.listings.label")}</span>

              <h2>{t("realtorPublicProfile.listings.title")}</h2>

              <p>{t("realtorPublicProfile.listings.description")}</p>
            </div>

            <div className={styles.count}>{ads.length}</div>
          </div>

          {ads.length > 0 ? (
            <div className={styles.listingsGrid}>
              {ads.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: Math.min(index * 0.05, 0.3),
                  }}
                >
                  <ListingCard
                    item={mapListingData(item)}
                    isFavorite={favIds.has(item.id)}
                    onFavoriteClick={onFavoriteClick}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Home size={25} />
              </div>

              <h3>{t("realtorPublicProfile.empty.title")}</h3>

              <p>{t("realtorPublicProfile.empty.description")}</p>
            </div>
          )}
        </motion.section>
      </div>
    </main>
  );
}
