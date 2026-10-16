"use client";

import { useState } from "react";

import {
  X,
  Camera,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  Globe,
  Hash,
  FileText,
  Check,
  Trash2,
} from "lucide-react";

import styles from "./AgencyEditModal.module.css";

import {
  getMe,
  updateMe,
  uploadAvatar as uploadAvatarRequest,
  deleteAvatar,
} from "@/utils/api";
import { useLanguage } from "@/context/LanguageContext";

export default function AgencyEditModal({ user, close }) {
  const { t } = useLanguage();

  const profile = user?.profile || {};

  const DEFAULT_LOGO = "/assets/AgencyImage.png";

  /*
   * =========================================================
   * INITIAL LOGO
   * =========================================================
   */

  const initialLogo =
    profile.avatar_url ||
    profile.logo_url ||
    profile.avatar ||
    profile.logo ||
    null;

  /*
   * =========================================================
   * STATE
   * =========================================================
   */

  const [loading, setLoading] = useState(false);

  const [companyName, setCompanyName] = useState(profile.company_name || "");

  const [directorName, setDirectorName] = useState(
    profile.first_name || profile.director_name || "",
  );

  const [inn, setInn] = useState(profile.inn || "");

  const [phone, setPhone] = useState(user?.phone || "");

  const [email, setEmail] = useState(user?.email || "");

  const [address, setAddress] = useState(profile.office_address || "");

  const [website, setWebsite] = useState(profile.website || "");

  const [about, setAbout] = useState(profile.about || "");

  const [logo, setLogo] = useState(initialLogo || DEFAULT_LOGO);

  const [logoFile, setLogoFile] = useState(null);

  const [logoRemoved, setLogoRemoved] = useState(false);

  /*
   * =========================================================
   * CUSTOM LOGO
   * =========================================================
   */

  const hasCustomLogo =
    Boolean(initialLogo) &&
    initialLogo !== DEFAULT_LOGO &&
    logo !== DEFAULT_LOGO &&
    !logoRemoved;

  /*
   * =========================================================
   * CHOOSE LOGO
   * =========================================================
   */

  function uploadLogo(e) {
    const file = e.target.files?.[0];

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert(t("agencyEditModal.errors.logoSize"));
      return;
    }

    setLogoFile(file);
    setLogoRemoved(false);
    setLogo(URL.createObjectURL(file));
  }

  /*
   * =========================================================
   * REMOVE LOGO
   * =========================================================
   */

  function removeLogo() {
    setLogoFile(null);
    setLogoRemoved(true);
    setLogo(DEFAULT_LOGO);
  }

  /*
   * =========================================================
   * GET TOKEN
   * =========================================================
   */

  function getToken() {
    const cookieMatch = document.cookie.match(/(^|;)\s*uytap_token=([^;]*)/);

    return (
      (cookieMatch ? decodeURIComponent(cookieMatch[2]) : null) ||
      localStorage.getItem("uytap_token")
    );
  }

  /*
   * =========================================================
   * SAVE
   * =========================================================
   */

  async function save() {
    if (loading) return;

    try {
      setLoading(true);

      const token = getToken();

      if (!token) {
        throw new Error(t("agencyEditModal.errors.session"));
      }

      /*
       * =====================================================
       * 1. LOGO: обращаемся к серверу только если логотип менялся
       * =====================================================
       */

      if (logoFile) {
        await uploadAvatarRequest(token, logoFile);
      } else if (
        logoRemoved &&
        initialLogo &&
        initialLogo !== DEFAULT_LOGO &&
        !initialLogo.startsWith("/assets/")
      ) {
        await deleteAvatar(token);
      }

      /*
       * =====================================================
       * 3. UPDATE PROFILE DATA
       * =====================================================
       */

      const payload = {
        companyName: companyName.trim(),

        directorName: directorName.trim(),

        inn: inn.trim(),

        officeAddress: address.trim(),

        website: website.trim(),

        about: about.trim(),
      };

      if (phone !== user?.phone) {
        payload.phone = phone.trim();
      }

      if (email !== user?.email) {
        payload.email = email.trim();
      }

      await updateMe(token, payload);

      /*
       * =====================================================
       * 4. GET FRESH USER
       * =====================================================
       */

      const freshUser = await getMe(token);

      /*
       * =====================================================
       * 5. NORMALIZE LOGO
       * =====================================================
       */

      const freshProfile = freshUser?.profile || {};

      let savedLogo;

      if (logoRemoved) {
        savedLogo =
          freshProfile.avatar_url ||
          freshProfile.logo_url ||
          freshProfile.avatar ||
          freshProfile.logo ||
          DEFAULT_LOGO;
      } else {
        savedLogo =
          freshProfile.avatar_url ||
          freshProfile.logo_url ||
          freshProfile.avatar ||
          freshProfile.logo ||
          logo ||
          DEFAULT_LOGO;
      }

      const normalizedUser = {
        ...freshUser,

        profile: {
          ...freshProfile,

          company_name: companyName.trim(),

          first_name: directorName.trim(),

          director_name: directorName.trim(),

          inn: inn.trim(),

          office_address: address.trim(),

          website: website.trim(),

          about: about.trim(),

          avatar_url: savedLogo,

          avatar: savedLogo,

          logo_url: savedLogo,

          logo: savedLogo,
        },
      };

      /*
       * =====================================================
       * 6. LOCAL STORAGE
       * =====================================================
       */

      localStorage.setItem("uytap_user", JSON.stringify(normalizedUser));

      /*
       * =====================================================
       * 7. EVENT
       * =====================================================
       */

      try {
        window.dispatchEvent(
          new CustomEvent("uytap:user-updated", {
            detail: normalizedUser,
          }),
        );
      } catch (error) {
        console.warn("Could not dispatch user-updated event", error);
      }

      /*
       * =====================================================
       * 8. CLOSE + RELOAD
       * =====================================================
       */

      close();

      window.location.reload();
    } catch (error) {
      console.error("AGENCY PROFILE SAVE ERROR:", error);

      alert(error?.message || t("agencyEditModal.errors.save"));
    } finally {
      setLoading(false);
    }
  }

  /*
   * =========================================================
   * UI
   * =========================================================
   */

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <button
          type="button"
          className={styles.close}
          onClick={close}
          disabled={loading}
          aria-label={t("agencyEditModal.actions.close")}
        >
          <X />
        </button>

        <div className={styles.scroll}>
          <header className={styles.header}>
            <h2>{t("agencyEditModal.header.title")}</h2>

            <p>{t("agencyEditModal.header.description")}</p>
          </header>

          {/* LOGO */}

          <div className={styles.avatarBlock}>
            <div className={styles.avatarWrapper}>
              <div className={styles.avatar}>
                <img
                  src={logo || DEFAULT_LOGO}
                  alt={companyName || t("agencyEditModal.logoAlt")}
                />
              </div>
            </div>

            <div className={styles.avatarActions}>
              <label className={styles.upload}>
                <Camera size={17} />

                <span>{t("agencyEditModal.logo.change")}</span>

                <input
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={uploadLogo}
                  disabled={loading}
                />
              </label>

              {hasCustomLogo && (
                <button
                  type="button"
                  className={styles.remove}
                  onClick={removeLogo}
                  disabled={loading}
                >
                  <Trash2 size={17} />

                  <span>{t("agencyEditModal.logo.remove")}</span>
                </button>
              )}
            </div>
          </div>

          {/* FIELDS */}

          <div className={styles.fields}>
            <div className={styles.inputBox}>
              <Building2 />

              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t("agencyEditModal.fields.companyName")}
                disabled={loading}
              />
            </div>

            <div className={styles.inputBox}>
              <User />

              <input
                value={directorName}
                onChange={(e) => setDirectorName(e.target.value)}
                placeholder={t("agencyEditModal.fields.director")}
                disabled={loading}
              />
            </div>

            <div className={styles.inputBox}>
              <Hash />

              <input
                value={inn}
                onChange={(e) => setInn(e.target.value)}
                placeholder={t("agencyEditModal.fields.inn")}
                disabled={loading}
              />
            </div>

            <div className={styles.inputBox}>
              <Phone />

              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("agencyEditModal.fields.phone")}
                disabled={loading}
              />
            </div>

            <div className={styles.inputBox}>
              <Mail />

              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("agencyEditModal.fields.email")}
                disabled={loading}
              />
            </div>

            <div className={styles.inputBox}>
              <MapPin />

              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t("agencyEditModal.fields.address")}
                disabled={loading}
              />
            </div>

            <div className={styles.inputBox}>
              <Globe />

              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder={t("agencyEditModal.fields.website")}
                disabled={loading}
              />
            </div>

            <div className={styles.textarea}>
              <FileText />

              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder={t("agencyEditModal.fields.about")}
                disabled={loading}
              />
            </div>
          </div>

          {/* SAVE */}

          <button
            type="button"
            className={styles.save}
            onClick={save}
            disabled={loading}
          >
            <Check size={18} />

            {loading
              ? t("agencyEditModal.actions.saving")
              : t("agencyEditModal.actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
