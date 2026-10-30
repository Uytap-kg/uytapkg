"use client";

import { useRef, useState } from "react";

import {
  X,
  Camera,
  Building2,
  Phone,
  MessageCircle,
  Globe,
  MapPin,
  FileText,
  Hash,
  User,
  Check,
  Trash2,
  Landmark,
} from "lucide-react";

import styles from "./DeveloperEditModal.module.css";

import { getMe, updateMe, uploadAvatar as uploadAvatarRequest } from "@/utils/api";
import { useLanguage } from "@/context/LanguageContext";

export default function DeveloperEditModal({ user, close }) {
  const { t } = useLanguage();

  const fileRef = useRef(null);

  const profile = user?.profile || {};

  const DEFAULT_LOGO = "/assets/DeveloperImage.png";

  const initialLogo =
    profile.avatar_url ||
    profile.logo_url ||
    profile.avatar ||
    user?.avatar_url ||
    user?.avatar ||
    DEFAULT_LOGO;

  const [loading, setLoading] = useState(false);

  const [firstName, setFirstName] = useState(profile.first_name || "");

  const [lastName, setLastName] = useState(profile.last_name || "");

  const [companyName, setCompanyName] = useState(
    profile.company_name || profile.company || "",
  );

  const [inn, setInn] = useState(profile.inn || "");

  const [phone, setPhone] = useState(user?.phone || "");

  const [whatsapp, setWhatsapp] = useState(
    profile.whatsapp || user?.phone || "",
  );

  const [website, setWebsite] = useState(profile.website || "");

  const [officeAddress, setOfficeAddress] = useState(
    profile.office_address || "",
  );

  const [about, setAbout] = useState(profile.about || "");

  const [logo, setLogo] = useState(initialLogo);

  const [logoFile, setLogoFile] = useState(null);

  const [logoRemoved, setLogoRemoved] = useState(false);

  /*
   * =========================================================
   * IMAGE
   * =========================================================
   */

  function handleLogoChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert(t("developerEditModal.errors.imageType"));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert(t("developerEditModal.errors.imageSize"));
      return;
    }

    setLogoFile(file);
    setLogo(URL.createObjectURL(file));
    setLogoRemoved(false);
  }

  function removeLogo() {
    setLogo(DEFAULT_LOGO);
    setLogoFile(null);
    setLogoRemoved(true);
  }

  /*
   * =========================================================
   * TOKEN
   * =========================================================
   */

  function getToken() {
    const cookie = document.cookie.match(/(^|;)\s*uytap_token=([^;]*)/);

    return (
      (cookie ? decodeURIComponent(cookie[2]) : null) ||
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

    const token = getToken();

    if (!token) {
      alert(t("developerEditModal.errors.session"));
      return;
    }

    if (!companyName.trim()) {
      alert(t("developerEditModal.errors.companyName"));
      return;
    }

    try {
      setLoading(true);

      /*
       * 1. UPDATE PROFILE
       */

      await updateMe(token, {
        firstName: firstName.trim(),

        lastName: lastName.trim(),

        phone: phone.trim(),

        companyName: companyName.trim(),

        inn: inn.trim(),

        whatsapp: whatsapp.trim(),

        website: website.trim(),

        officeAddress: officeAddress.trim(),

        about: about.trim(),
      });

      /*
       * 2. UPLOAD LOGO
       */

      if (logoFile) {
        await uploadAvatarRequest(token, logoFile);
      }

      /*
       * 3. GET FRESH USER
       */

      const freshUser = await getMe(token);

      const freshProfile = {
        ...(freshUser.profile || {}),
      };

      if (logoRemoved) {
        freshProfile.avatar_url = freshProfile.avatar_url || DEFAULT_LOGO;

        freshProfile.avatar = freshProfile.avatar || DEFAULT_LOGO;
      }

      /*
       * 4. LOCAL STORAGE
       */

      const updatedUser = {
        ...freshUser,

        phone: phone.trim(),

        profile: {
          ...freshProfile,

          first_name: firstName.trim(),

          last_name: lastName.trim(),

          company_name: companyName.trim(),

          inn: inn.trim(),

          whatsapp: whatsapp.trim(),

          website: website.trim(),

          office_address: officeAddress.trim(),

          about: about.trim(),
        },
      };

      localStorage.setItem("uytap_user", JSON.stringify(updatedUser));

      /*
       * 5. EVENT
       */

      window.dispatchEvent(
        new CustomEvent("uytap:user-updated", {
          detail: updatedUser,
        }),
      );

      /*
       * 6. CLOSE
       */

      close();

      /*
       * 7. RELOAD
       */

      window.location.reload();
    } catch (error) {
      console.error("DEVELOPER PROFILE SAVE ERROR:", error);

      alert(error?.message || t("developerEditModal.errors.save"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {/* CLOSE */}

        <button
          type="button"
          className={styles.close}
          onClick={close}
          disabled={loading}
          aria-label={t("developerEditModal.actions.close")}
        >
          <X />
        </button>

        <div className={styles.scroll}>
          {/* HEADER */}

          <header className={styles.header}>
            <div className={styles.headerBadge}>
              <Landmark />

              {t("developerEditModal.header.badge")}
            </div>

            <h2>{t("developerEditModal.header.title")}</h2>

            <p>{t("developerEditModal.header.description")}</p>
          </header>

          {/* LOGO */}

          <section className={styles.logoSection}>
            <div className={styles.logoWrapper}>
              <div className={styles.logo}>
                {logo ? (
                  <img src={logo} alt={t("developerEditModal.logo.alt")} />
                ) : (
                  <Building2 />
                )}
              </div>

              <div className={styles.logoCamera}>
                <Camera />
              </div>
            </div>

            <div className={styles.logoInfo}>
              <strong>{t("developerEditModal.logo.title")}</strong>

              <span>{t("developerEditModal.logo.format")}</span>

              <div className={styles.logoActions}>
                <label className={styles.uploadButton}>
                  <Camera />

                  <span>
                    {logoFile
                      ? t("developerEditModal.logo.change")
                      : t("developerEditModal.logo.upload")}
                  </span>

                  <input
                    ref={fileRef}
                    hidden
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoChange}
                    disabled={loading}
                  />
                </label>

                {logo && !logoRemoved && (
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={removeLogo}
                    disabled={loading}
                  >
                    <Trash2 />

                    {t("developerEditModal.logo.remove")}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* COMPANY */}

          <section className={styles.formSection}>
            <div className={styles.sectionTitle}>
              <Building2 />

              <div>
                <strong>
                  {t("developerEditModal.sections.company.title")}
                </strong>

                <span>
                  {t("developerEditModal.sections.company.description")}
                </span>
              </div>
            </div>

            <div className={styles.fields}>
              <Field
                icon={<Building2 />}
                label={t("developerEditModal.fields.companyName.label")}
                value={companyName}
                onChange={setCompanyName}
                placeholder={t(
                  "developerEditModal.fields.companyName.placeholder",
                )}
                disabled={loading}
              />

              <Field
                icon={<Hash />}
                label={t("developerEditModal.fields.inn.label")}
                value={inn}
                onChange={setInn}
                placeholder={t("developerEditModal.fields.inn.placeholder")}
                disabled={loading}
              />
            </div>
          </section>

          {/* REPRESENTATIVE */}

          <section className={styles.formSection}>
            <div className={styles.sectionTitle}>
              <User />

              <div>
                <strong>
                  {t("developerEditModal.sections.representative.title")}
                </strong>

                <span>
                  {t("developerEditModal.sections.representative.description")}
                </span>
              </div>
            </div>

            <div className={styles.fields}>
              <div className={styles.row}>
                <Field
                  icon={<User />}
                  label={t("developerEditModal.fields.firstName.label")}
                  value={firstName}
                  onChange={setFirstName}
                  placeholder={t(
                    "developerEditModal.fields.firstName.placeholder",
                  )}
                  disabled={loading}
                />

                <Field
                  icon={<User />}
                  label={t("developerEditModal.fields.lastName.label")}
                  value={lastName}
                  onChange={setLastName}
                  placeholder={t(
                    "developerEditModal.fields.lastName.placeholder",
                  )}
                  disabled={loading}
                />
              </div>
            </div>
          </section>

          {/* CONTACTS */}

          <section className={styles.formSection}>
            <div className={styles.sectionTitle}>
              <Phone />

              <div>
                <strong>
                  {t("developerEditModal.sections.contacts.title")}
                </strong>

                <span>
                  {t("developerEditModal.sections.contacts.description")}
                </span>
              </div>
            </div>

            <div className={styles.fields}>
              <Field
                icon={<Phone />}
                label={t("developerEditModal.fields.phone.label")}
                value={phone}
                onChange={setPhone}
                placeholder={t("developerEditModal.fields.phone.placeholder")}
                type="tel"
                disabled={loading}
              />

              <Field
                icon={<MessageCircle />}
                label={t("developerEditModal.fields.whatsapp.label")}
                value={whatsapp}
                onChange={setWhatsapp}
                placeholder={t(
                  "developerEditModal.fields.whatsapp.placeholder",
                )}
                type="tel"
                disabled={loading}
              />

              <Field
                icon={<Globe />}
                label={t("developerEditModal.fields.website.label")}
                value={website}
                onChange={setWebsite}
                placeholder={t("developerEditModal.fields.website.placeholder")}
                disabled={loading}
              />

              <Field
                icon={<MapPin />}
                label={t("developerEditModal.fields.officeAddress.label")}
                value={officeAddress}
                onChange={setOfficeAddress}
                placeholder={t(
                  "developerEditModal.fields.officeAddress.placeholder",
                )}
                disabled={loading}
              />
            </div>
          </section>

          {/* ABOUT */}

          <section className={styles.formSection}>
            <div className={styles.sectionTitle}>
              <FileText />

              <div>
                <strong>{t("developerEditModal.sections.about.title")}</strong>

                <span>
                  {t("developerEditModal.sections.about.description")}
                </span>
              </div>
            </div>

            <div className={styles.textareaBox}>
              <FileText />

              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder={t("developerEditModal.fields.about.placeholder")}
                disabled={loading}
                maxLength={1000}
              />

              <span>{about.length}/1000</span>
            </div>
          </section>

          {/* SAVE */}

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.cancel}
              onClick={close}
              disabled={loading}
            >
              {t("developerEditModal.actions.cancel")}
            </button>

            <button
              type="button"
              className={styles.save}
              onClick={save}
              disabled={loading}
            >
              <Check />

              {loading
                ? t("developerEditModal.actions.saving")
                : t("developerEditModal.actions.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * FIELD
 * =========================================================
 */

function Field({
  icon,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>

      <div className={styles.inputBox}>
        {icon}

        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>
    </label>
  );
}
