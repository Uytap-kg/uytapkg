"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Phone,
  MessageCircle,
  Globe,
  MapPin,
  Home,
  Building2,
  Mail,
  Hash,
  ArrowUpRight,
  User,
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";

import { mapListingData } from "@/utils/mapListingData";
import { useLanguage } from "@/context/LanguageContext";

import styles from "./DeveloperPublicProfile.module.css";
import ListingCard from "@/components/ui/ListingCard/ListingCard";

export default function DeveloperPublicProfile({
  user,
  favIds = new Set(),
  onFavoriteClick,
}) {
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState("complexes");

  if (!user) return null;

  const profile = user.profile || {};

  const company =
    profile.company_name ||
    profile.company ||
    t("developerPublicProfile.defaults.company");

  const fullName =
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim() ||
    t("developerPublicProfile.defaults.representative");

  const avatar =
    profile.avatar_url ||
    profile.avatar ||
    user.avatar_url ||
    user.avatar ||
    "/assets/DeveloperImage.png";

  const phone = user.phone || "";
  const email = user.email || "";

  const whatsapp = phone.replace(/\D/g, "");

  const projects =
    user.complexes ||
    profile.projects ||
    profile.residential_complexes ||
    profile.complexes ||
    [];

  const ads = user.ads || profile.ads || [];

  const websiteUrl = profile.website
    ? profile.website.startsWith("http")
      ? profile.website
      : `https://${profile.website}`
    : "";

  const getProjectName = (project) =>
    project.name ||
    project.title ||
    project.project_name ||
    t("developerPublicProfile.defaults.project");

  const getProjectAddress = (project) =>
    project.address ||
    project.location ||
    project.office_address ||
    t("developerPublicProfile.defaults.address");

  const getProjectImage = (project) =>
    project.cover_photo ||
    project.image_url ||
    project.image ||
    project.cover ||
    project.photo ||
    "/assets/DeveloperImage.png";

  const getProjectStatus = (project) => {
    const status = project.completion_status || project.status || "building";

    if (
      status === "completed" ||
      status === "complete" ||
      status === "finished"
    ) {
      return t("developerPublicProfile.projectStatuses.completed");
    }

    return t("developerPublicProfile.projectStatuses.building");
  };

  const isProjectCompleted = (project) => {
    const status = project.completion_status || project.status || "building";

    return (
      status === "completed" || status === "complete" || status === "finished"
    );
  };

  const getProjectApartments = (project) =>
    project.features?.apartments ||
    project.apartments_count ||
    project.apartments ||
    project.units_count ||
    0;

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlowOne} />
      <div className={styles.backgroundGlowTwo} />

      <Link href="/" className={styles.backButton}>
        <ArrowLeft size={17} />
        <span>{t("developerPublicProfile.topBar.home")}</span>
      </Link>

      <section className={styles.profileCard}>
        <div className={styles.profileAccent} />

        <div className={styles.profileMain}>
          {/* AVATAR */}

          <div className={styles.avatarWrapper}>
            <div className={styles.avatar}>
              <img src={avatar} alt={company} />
            </div>

            {user.isVerified && (
              <div
                className={styles.avatarVerified}
                title={t("developerPublicProfile.verifiedCompany")}
              >
                <CheckCircle2 />
              </div>
            )}
          </div>

          {/* INFO */}

          <div className={styles.profileInfo}>
            <div className={styles.badges}>
              <span className={styles.typeBadge}>
                <Building2 />
                {t("developerPublicProfile.type")}
              </span>

              {user.isVerified && (
                <span className={styles.verifiedBadge}>
                  <CheckCircle2 />
                  {t("developerPublicProfile.verified")}
                </span>
              )}
            </div>

            <h1>{company}</h1>

            <div className={styles.representative}>
              <User />

              <span>{t("developerPublicProfile.representative.label")}</span>

              <strong>{fullName}</strong>
            </div>
          </div>
        </div>

        {/* DESCRIPTION */}

        <div className={styles.descriptionBlock}>
          <span className={styles.sectionNumber}>01</span>

          <div>
            <span className={styles.sectionCaption}>
              {t("developerPublicProfile.about.label")}
            </span>

            <p className={styles.description}>
              {profile.about || t("developerPublicProfile.defaults.about")}
            </p>
          </div>
        </div>

        {/* CONTACTS */}

        <div className={styles.contactsGrid}>
          {phone && (
            <a href={`tel:${phone}`} className={styles.contactCard}>
              <div className={styles.contactIcon}>
                <Phone />
              </div>

              <div className={styles.contactContent}>
                <span>{t("developerPublicProfile.contacts.phone")}</span>

                <strong>{phone}</strong>
              </div>

              <ArrowUpRight className={styles.contactArrow} />
            </a>
          )}

          {email && (
            <a href={`mailto:${email}`} className={styles.contactCard}>
              <div className={styles.contactIcon}>
                <Mail />
              </div>

              <div className={styles.contactContent}>
                <span>{t("developerPublicProfile.contacts.email")}</span>

                <strong>{email}</strong>
              </div>

              <ArrowUpRight className={styles.contactArrow} />
            </a>
          )}

          {profile.office_address && (
            <div className={styles.contactCard}>
              <div className={styles.contactIcon}>
                <MapPin />
              </div>

              <div className={styles.contactContent}>
                <span>{t("developerPublicProfile.contacts.office")}</span>

                <strong>{profile.office_address}</strong>
              </div>
            </div>
          )}

          {profile.inn && (
            <div className={styles.contactCard}>
              <div className={styles.contactIcon}>
                <Hash />
              </div>

              <div className={styles.contactContent}>
                <span>{t("developerPublicProfile.contacts.inn")}</span>

                <strong>{profile.inn}</strong>
              </div>
            </div>
          )}

          {websiteUrl && (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.contactCard}
            >
              <div className={styles.contactIcon}>
                <Globe />
              </div>

              <div className={styles.contactContent}>
                <span>{t("developerPublicProfile.contacts.website")}</span>

                <strong>{profile.website.replace(/^https?:\/\//, "")}</strong>
              </div>

              <ArrowUpRight className={styles.contactArrow} />
            </a>
          )}
        </div>

        {/* ACTIONS */}

        {(whatsapp || websiteUrl) && (
          <div className={styles.actions}>
            {whatsapp && (
              <a
                href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
                  "Здравствуйте! Я нашёл вашу компанию на сайте uytap.kg и хотел бы узнать подробнее о ваших жилых комплексах и недвижимости. Подскажите, пожалуйста, с кем можно обсудить этот вопрос?",
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.primaryAction}
              >
                <MessageCircle />

                {t("developerPublicProfile.actions.whatsapp")}

                <ArrowUpRight />
              </a>
            )}

            {websiteUrl && (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.secondaryAction}
              >
                <Globe />

                {t("developerPublicProfile.actions.website")}

                <ArrowUpRight />
              </a>
            )}
          </div>
        )}
      </section>

      {/* =====================================================
          STATS / TABS
      ===================================================== */}

      <section className={styles.stats}>
        <button
          type="button"
          className={`${styles.stat} ${
            activeTab === "complexes" ? styles.statActive : ""
          }`}
          onClick={() => setActiveTab("complexes")}
        >
          <div className={styles.statIcon}>
            <Building2 />
          </div>

          <div className={styles.statContent}>
            <strong>{projects.length}</strong>

            <span>{t("developerPublicProfile.stats.complexes")}</span>
          </div>

          <ChevronRight className={styles.statArrow} />
        </button>

        <button
          type="button"
          className={`${styles.stat} ${
            activeTab === "listings" ? styles.statActive : ""
          }`}
          onClick={() => setActiveTab("listings")}
        >
          <div className={styles.statIcon}>
            <Home />
          </div>

          <div className={styles.statContent}>
            <strong>{ads.length}</strong>

            <span>{t("developerPublicProfile.stats.ads")}</span>
          </div>

          <ChevronRight className={styles.statArrow} />
        </button>
      </section>

      {/* =====================================================
          CONTENT
      ===================================================== */}

      <section className={styles.contentSection}>
        {/* SECTION HEADER */}

        <div className={styles.contentHeader}>
          <div>
            <span className={styles.contentEyebrow}>
              {activeTab === "complexes"
                ? `02 / ${t("developerPublicProfile.tabs.projectsShort")}`
                : `02 / ${t("developerPublicProfile.tabs.realEstateShort")}`}
            </span>

            <h2>
              {activeTab === "complexes"
                ? t("developerPublicProfile.content.complexes.title")
                : t("developerPublicProfile.content.ads.title")}
            </h2>

            <p>
              {activeTab === "complexes"
                ? t("developerPublicProfile.content.complexes.description")
                : t("developerPublicProfile.content.ads.description")}
            </p>
          </div>

          <div className={styles.contentCount}>
            {activeTab === "complexes" ? projects.length : ads.length}

            <span>{t("developerPublicProfile.content.count")}</span>
          </div>
        </div>

        {/* =================================================
            COMPLEXES
        ================================================= */}

        {activeTab === "complexes" && (
          <>
            {projects.length > 0 ? (
              <div className={styles.projectsGrid}>
                {projects.map((project) => (
                  <Link
                    href={`/complexes/${project.id}`}
                    key={project.id}
                    className={styles.projectCard}
                  >
                    <div className={styles.projectImage}>
                      <img
                        src={getProjectImage(project)}
                        alt={getProjectName(project)}
                      />

                      <div
                        className={`${styles.projectStatus} ${
                          isProjectCompleted(project)
                            ? styles.completed
                            : styles.building
                        }`}
                      >
                        <span />

                        {getProjectStatus(project)}
                      </div>

                      <div className={styles.projectOverlay} />

                      <div className={styles.projectImageTitle}>
                        {getProjectName(project)}
                      </div>
                    </div>

                    <div className={styles.projectContent}>
                      <h3>{getProjectName(project)}</h3>

                      <div className={styles.projectAddress}>
                        <MapPin />

                        <span>{getProjectAddress(project)}</span>
                      </div>

                      {getProjectApartments(project) > 0 && (
                        <div className={styles.projectMeta}>
                          <Home />

                          <span>
                            {getProjectApartments(project)}{" "}
                            {t("developerPublicProfile.project.apartments")}
                          </span>
                        </div>
                      )}

                      <div className={styles.projectLink}>
                        <span>
                          {t("developerPublicProfile.project.details")}
                        </span>

                        <ArrowUpRight />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <Building2 />
                </div>

                <h3>{t("developerPublicProfile.empty.complexes.title")}</h3>

                <p>{t("developerPublicProfile.empty.complexes.description")}</p>
              </div>
            )}
          </>
        )}

        {/* =================================================
            LISTINGS
        ================================================= */}

        {activeTab === "listings" && (
          <>
            {ads.length > 0 ? (
              <div className={styles.listingsGrid}>
                {ads.map((item) => (
                  <ListingCard
                    key={item.id}
                    item={mapListingData(item)}
                    isFavorite={favIds.has(item.id)}
                    onFavoriteClick={onFavoriteClick}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <Home />
                </div>

                <h3>{t("developerPublicProfile.empty.ads.title")}</h3>

                <p>{t("developerPublicProfile.empty.ads.description")}</p>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
