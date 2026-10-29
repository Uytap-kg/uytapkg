"use client";

import { motion } from "framer-motion";
import {
  Phone,
  MessageCircle,
  Globe,
  MapPin,
  Mail,
  Home,
  Building2,
  CheckCircle,
  ArrowUpRight,
  ArrowLeft,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import { mapListingData } from "@/utils/mapListingData";

import styles from "./RealtorPublicProfile.module.css";
import Link from "next/link";
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

  const phone = user.phone || "";
  const email = user.email || "";
  const whatsapp = phone.replace(/\D/g, "");

  const website = profile.website || "";
  const officeAddress = profile.office_address || "";

  const ads =
    user.ads || profile.ads || profile.listings || profile.properties || [];

  const adsCount = profile.ads_count ?? ads.length;

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} />
      <div className={styles.backgroundGlowTwo} />

      <div className={styles.container}>
        {/* PROFILE */}

        <Link href="/" className={styles.backButton}>
          <ArrowLeft size={17} />
          <span>{t("realtorPublicProfile.topBar.home")}</span>
        </Link>

        <motion.section
          className={styles.profileCard}
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className={styles.cardGlow} />

          <div className={styles.profileTop}>
            {/* AVATAR */}

            <motion.div
              className={styles.avatarColumn}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <div className={styles.avatarRing}>
                <div className={styles.avatar}>
                  <img src={avatarUrl} alt={name} />
                </div>
              </div>

              {user.isVerified && (
                <div className={styles.avatarVerified}>
                  <CheckCircle />
                  {t("realtorPublicProfile.verification.profile")}
                </div>
              )}
            </motion.div>

            {/* INFO */}

            <motion.div
              className={styles.info}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              <div className={styles.topMeta}>
                <span className={styles.badge}>
                  <span className={styles.badgeDot} />
                  {t("realtorPublicProfile.role")}
                </span>

                {user.isVerified && (
                  <span className={styles.verifiedLabel}>
                    <CheckCircle />
                    {t("realtorPublicProfile.verification.short")}
                  </span>
                )}
              </div>

              <h1>{name}</h1>

              {company && (
                <div className={styles.company}>
                  <Building2 />
                  <span>{company}</span>
                </div>
              )}

              <p className={styles.description}>
                {profile.about || t("realtorPublicProfile.defaults.about")}
              </p>

              <div className={styles.actions}>
                <div className={styles.primaryAction}>
                  <Phone size={18} />
                  <span>Phone: {phone || "Not provided"}</span>
                </div>

                <a
                  href={whatsapp ? `https://wa.me/${whatsapp}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.secondaryAction} ${
                    !whatsapp ? styles.disabledAction : ""
                  }`}
                  onClick={(e) => {
                    if (!whatsapp) e.preventDefault();
                  }}
                  aria-disabled={!whatsapp}
                >
                  <MessageCircle size={18} />
                  <span>WhatsApp</span>
                </a>

                <div className={styles.secondaryAction}>
                  <Mail size={18} />
                  <span>Email: {email || "Not provided"}</span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* DETAILS */}

          {(officeAddress || website) && (
            <div className={styles.details}>
              {officeAddress && (
                <div className={styles.detail}>
                  <div className={styles.detailIcon}>
                    <MapPin />
                  </div>

                  <div className={styles.detailContent}>
                    <span>{t("realtorPublicProfile.details.office")}</span>

                    <strong>{officeAddress}</strong>
                  </div>
                </div>
              )}

              {website && (
                <a
                  href={
                    website.startsWith("http") ? website : `https://${website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.detail}
                >
                  <div className={styles.detailIcon}>
                    <Globe />
                  </div>

                  <div className={styles.detailContent}>
                    <span>{t("realtorPublicProfile.details.website")}</span>

                    <strong>{website.replace(/^https?:\/\//, "")}</strong>
                  </div>

                  <ArrowUpRight className={styles.detailArrow} />
                </a>
              )}
            </div>
          )}
        </motion.section>

        {/* STATS */}

        <motion.section
          className={styles.stats}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.25 }}
        >
          <div className={styles.statCard}>
            <div className={styles.statIcon}>
              <Home />
            </div>

            <div>
              <strong>{adsCount}</strong>

              <span>{t("realtorPublicProfile.stats.activeAds")}</span>
            </div>
          </div>
        </motion.section>

        {/* LISTINGS */}

        <motion.section
          className={styles.listingsSection}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
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
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.35,
                    delay: 0.08 * index,
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
                <Home />
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
