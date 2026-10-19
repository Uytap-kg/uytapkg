"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMyComplexes } from "@/utils/api";

import {
  Pencil,
  Building2,
  Phone,
  MessageCircle,
  Globe,
  MapPin,
  Home,
  Heart,
  CreditCard,
  LogOut,
  Landmark,
  Mail,
  House,
  Hash,
  ArrowUpRight,
  Plus,
  CalendarDays,
  Layers3,
  CheckCircle2Icon,
  ShieldCheck,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

import styles from "./DeveloperProfile.module.css";

import DeveloperEditModal from "./developerEdit/DeveloperEditModal";
import { useLanguage } from "@/context/LanguageContext";
import Header from "@/components/pageComponents/header/Header";

export default function DeveloperProfile({ user, adsCount = 0 }) {
  const router = useRouter();
  const { t } = useLanguage();

  const [edit, setEdit] = useState(false);
  const [dbProjects, setDbProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoadingProjects(false);
      return;
    }

    const token = localStorage.getItem("uytap_token");

    if (!token) {
      setLoadingProjects(false);
      return;
    }

    getMyComplexes(token)
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          const mapped = res.data.map((item) => ({
            id: item.id,
            name: item.name,
            address: item.address,
            image_url:
              item.cover_photo ||
              "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85",
            completion_status: item.completion_status,
            completion_date: item.completion_date,
            apartments: item.features?.apartments || 0,
          }));

          setDbProjects(mapped);
        }
      })
      .catch((err) =>
        console.error("Error fetching developer profile projects:", err),
      )
      .finally(() => setLoadingProjects(false));
  }, [user]);

  if (!user) return null;

  const profile = user.profile || {};

  const company =
    profile.company_name ||
    profile.company ||
    t("developerProfile.defaults.company");

  const firstName = profile.first_name || "";

  const lastName = profile.last_name || "";

  const fullName =
    `${firstName} ${lastName}`.trim() ||
    t("developerProfile.defaults.representative");

  const avatar =
    profile.avatar_url ||
    profile.avatar ||
    user.avatar_url ||
    user.avatar ||
    "/assets/DeveloperImage.png";

  const whatsapp = user.phone?.replace(/\D/g, "") || "";

  const isVerified =
    user.isVerified === true ||
    profile.is_verified === true ||
    profile.verified === true ||
    profile.profile_verified === true ||
    user.is_verified === true ||
    user.verified === true;

  const projects =
    dbProjects.length > 0
      ? dbProjects
      : profile.projects ||
        profile.residential_complexes ||
        profile.complexes ||
        [];

  function logout() {
    localStorage.removeItem("uytap_user");

    localStorage.removeItem("uytap_token");

    document.cookie = "uytap_token=; path=/; max-age=0";

    window.location.href = "/login";
  }

  function openVerification() {
    router.push("/verify");
  }

  function getProjectName(project) {
    return (
      project.name ||
      project.title ||
      project.project_name ||
      t("developerProfile.projectDefaults.name")
    );
  }

  function getProjectAddress(project) {
    return (
      project.address ||
      project.location ||
      project.office_address ||
      t("developerProfile.projectDefaults.address")
    );
  }

  function getProjectImage(project) {
    return (
      project.image_url ||
      project.image ||
      project.cover ||
      project.photo ||
      "/assets/DeveloperImage.png"
    );
  }

  function getProjectStatus(project) {
    return (
      project.completion_status ||
      project.status ||
      project.construction_status ||
      t("developerProfile.projectDefaults.status")
    );
  }

  function getProjectApartments(project) {
    return (
      project.apartments_count || project.apartments || project.units_count || 0
    );
  }

  const totalApartments =
    dbProjects.length > 0
      ? dbProjects.reduce(
          (sum, project) => sum + (Number(project.apartments) || 0),
          0,
        )
      : profile.apartments_count || 0;

  return (
    <main className={styles.page}>
      {/* PROFILE */}
      <Header />

      <section className={styles.profileCard}>
        <div className={styles.glow} />

        <div className={styles.header}>
          {/* AVATAR */}

          <div className={styles.avatarWrapper}>
            <div className={styles.avatar}>
              <img src={avatar} alt={company} />
            </div>
          </div>

          {/* INFO */}

          <div className={styles.info}>
            <div className={styles.badge}>
              <Building2 />

              {t("developerProfile.badge")}
            </div>

            <div className={styles.titleRow}>
              <h1>{company}</h1>

              {isVerified && (
                <div
                  className={styles.verifiedBadge}
                  title={t("developerProfile.verification.verified")}
                >
                  <CheckCircle2Icon />
                </div>
              )}
            </div>

            <p className={styles.person}>
              <UserIcon />

              {fullName}
            </p>

            <p className={styles.description}>
              {profile.about || t("developerProfile.defaults.about")}
            </p>
          </div>

          {/* EDIT */}

          <button
            type="button"
            className={styles.edit}
            onClick={() => setEdit(true)}
            aria-label={t("developerProfile.actions.editAria")}
          >
            <Pencil />
          </button>
        </div>

        {/* VERIFICATION */}

        {!isVerified && (
          <div className={styles.verificationBanner}>
            <div className={styles.verificationIcon}>
              <ShieldCheck />
            </div>

            <div className={styles.verificationContent}>
              <div className={styles.verificationTitle}>
                <AlertCircle />

                {t("developerProfile.verification.title")}
              </div>

              <p>{t("developerProfile.verification.description")}</p>

              <span className={styles.verificationWarning}>
                <AlertCircle />

                {t("developerProfile.verification.warning")}
              </span>
            </div>

            <button
              type="button"
              className={styles.verificationButton}
              onClick={openVerification}
            >
              <ShieldCheck />

              {t("developerProfile.verification.button")}

              <ChevronRight />
            </button>
          </div>
        )}

        {/* CONTACTS */}

        <div className={styles.contacts}>
          {user.phone && (
            <div className={styles.contactCard}>
              <Phone />

              <div>
                <small>{t("developerProfile.contacts.phone")}</small>

                <strong>{user.phone}</strong>
              </div>
            </div>
          )}

          {user.email && (
            <div className={styles.contactCard}>
              <Mail />

              <div>
                <small>{t("developerProfile.contacts.email")}</small>

                <strong>{user.email}</strong>
              </div>
            </div>
          )}

          {profile.inn && (
            <div className={styles.contactCard}>
              <Hash />

              <div>
                <small>{t("developerProfile.contacts.inn")}</small>

                <strong>{profile.inn}</strong>
              </div>
            </div>
          )}

          {profile.office_address && (
            <div className={styles.contactCard}>
              <MapPin />

              <div>
                <small>{t("developerProfile.contacts.office")}</small>

                <strong>{profile.office_address}</strong>
              </div>
            </div>
          )}

          {profile.website && (
            <a
              className={styles.contactCard}
              href={
                profile.website.startsWith("http")
                  ? profile.website
                  : `https://${profile.website}`
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              <Globe />

              <div>
                <small>{t("developerProfile.contacts.website")}</small>

                <strong>{profile.website.replace(/^https?:\/\//, "")}</strong>
              </div>

              <ArrowUpRight className={styles.external} />
            </a>
          )}
        </div>

        {/* ACTIONS */}

        <div className={styles.actions}>
          {whatsapp && (
            <a
              className={styles.whatsapp}
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle />

              {t("developerProfile.actions.whatsapp")}
            </a>
          )}

          {profile.website && (
            <a
              className={styles.website}
              href={
                profile.website.startsWith("http")
                  ? profile.website
                  : `https://${profile.website}`
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              <Globe />

              {t("developerProfile.actions.website")}

              <ArrowUpRight />
            </a>
          )}
        </div>
      </section>

      {/* STATISTICS */}

      <section className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statIcon}>
            <Building2 />
          </div>

          <div>
            <strong>{profile.projects_count || projects.length || 0}</strong>

            <span>{t("developerProfile.stats.projects")}</span>
          </div>
        </div>

        <div className={styles.stat}>
          <div className={styles.statIcon}>
            <Home />
          </div>

          <div>
            <strong>{totalApartments}</strong>

            <span>{t("developerProfile.stats.apartments")}</span>
          </div>
        </div>

        <div className={styles.stat}>
          <div className={styles.statIcon}>
            <Layers3 />
          </div>

          <div>
            <strong>{adsCount}</strong>

            <span>{t("developerProfile.stats.ads")}</span>
          </div>
        </div>
      </section>

      {/* PROJECTS */}

      <section className={styles.projectsSection}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>
              <Building2 />

              {t("developerProfile.portfolio.label")}
            </div>

            <h2>{t("developerProfile.portfolio.title")}</h2>

            <p>{t("developerProfile.portfolio.description")}</p>
          </div>

          <a href="/add-residential-complex" className={styles.addProject}>
            <Plus />

            {t("developerProfile.portfolio.add")}
          </a>
        </div>

        {loadingProjects ? (
          <div className={styles.emptyProjects}>
            <div className={styles.emptyIcon}>
              <Building2 />
            </div>

            <h3>{t("developerProfile.projects.loading")}</h3>
          </div>
        ) : projects.length > 0 ? (
          <div className={styles.projectsGrid}>
            {projects.map((project, index) => {
              const name = getProjectName(project);

              const address = getProjectAddress(project);

              const image = getProjectImage(project);

              const status = getProjectStatus(project);

              const apartments = getProjectApartments(project);

              return (
                <article
                  className={styles.projectCard}
                  key={project.id || project._id || index}
                >
                  <div className={styles.projectImage}>
                    <img src={image} alt={name} />

                    <span className={styles.projectStatus}>{status}</span>
                  </div>

                  <div className={styles.projectContent}>
                    <h3>{name}</h3>

                    <p className={styles.projectAddress}>
                      <MapPin />

                      {address}
                    </p>

                    <div className={styles.projectMeta}>
                      <span>
                        <Home />
                        {apartments} {t("developerProfile.project.apartments")}
                      </span>

                      {project.completion_date && (
                        <span>
                          <CalendarDays />

                          {project.completion_date}
                        </span>
                      )}
                    </div>

                    <a
                      href={
                        project.id
                          ? `/profile/projects/${project.id}`
                          : "/profile/projects"
                      }
                      className={styles.projectLink}
                    >
                      {t("developerProfile.project.details")}

                      <ArrowUpRight />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyProjects}>
            <div className={styles.emptyIcon}>
              <Building2 />
            </div>

            <h3>{t("developerProfile.projects.empty.title")}</h3>

            <p>{t("developerProfile.projects.empty.description")}</p>

            <a href="/add-residential-complex" className={styles.emptyButton}>
              <Plus />

              {t("developerProfile.projects.empty.button")}
            </a>
          </div>
        )}
      </section>

      {/* MENU */}

      <section className={styles.menu}>
        <a href="/">
          <House />

          {t("developerProfile.menu.home")}
        </a>

        <a href="/profile/projects">
          <Building2 />

          {t("developerProfile.menu.projects")}
        </a>

        <a href="/profile/ads">
          <Home />

          {t("developerProfile.menu.ads")}
        </a>

        <a href="/favorites">
          <Heart />

          {t("developerProfile.menu.favorites")}
        </a>

        <a href="/profile/tariff">
          <CreditCard />

          {t("developerProfile.menu.tariff")}
        </a>

        <button type="button" onClick={logout}>
          <LogOut />

          {t("developerProfile.menu.logout")}
        </button>
      </section>

      {/* EDIT MODAL */}

      {edit && <DeveloperEditModal user={user} close={() => setEdit(false)} />}
    </main>
  );
}

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
