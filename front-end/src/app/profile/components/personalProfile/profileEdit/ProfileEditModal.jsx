"use client";

import { useState } from "react";

import {
  getMe,
  updateMe,
  uploadAvatar as uploadAvatarRequest,
  deleteAvatar,
} from "@/utils/api";

import {
  X,
  Camera,
  Phone,
  User,
  FileText,
  Check,
  Trash2,
  UserRoundCog,
  Building,
  Hash,
  Globe,
  MapPin,
} from "lucide-react";

import styles from "./ProfileEditModal.module.css";
import CustomSelect from "@/components/ui/customSelect/CustomSelect";

import { useLanguage } from "@/context/LanguageContext";

export default function ProfileEditModal({ user, close }) {
  const { t } = useLanguage();

  const profile = user?.profile || {};

  const initialAvatar =
    profile.avatar_url ||
    profile.avatar ||
    user?.avatar_url ||
    user?.avatar ||
    null;

  const [loading, setLoading] = useState(false);

  const [firstName, setFirstName] = useState(profile.first_name || "");

  const [lastName, setLastName] = useState(profile.last_name || "");

  const [phone, setPhone] = useState(user?.phone || "");

  const [about, setAbout] = useState(profile.about || "");

  const [inn, setInn] = useState(profile.inn || "");

  const [officeAddress, setOfficeAddress] = useState(
    profile.office_address || "",
  );

  const [actualAddress, setActualAddress] = useState(
    profile.actualAddress || "",
  );

  const [website, setWebsite] = useState(profile.website || "");

  const [region, setRegion] = useState(profile.region || "");

  const [companyName, setCompanyName] = useState(profile.company_name || "");

  const [fullName, setFullName] = useState(
    profile.first_name && profile.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : profile.first_name || "",
  );

  const DEFAULT_AVATAR = "/assets/personalImage.png";

  const [avatar, setAvatar] = useState(
    profile.avatar_url || profile.avatar || DEFAULT_AVATAR,
  );

  const [avatarFile, setAvatarFile] = useState(null);

  const [avatarRemoved, setAvatarRemoved] = useState(false);

  /*
   * =========================================================
   * ACCOUNT TYPE
   * =========================================================
   *
   * Храним именно техническое значение:
   *
   * personal
   * realtor
   * agency
   * developer
   *
   * Поэтому переключение языка не ломает выбранный тип.
   */

  const [selectedRole, setSelectedRole] = useState(
    user?.accountType || "personal",
  );

  const accountTypes = ["personal", "realtor", "agency", "developer"];

  const accountTypeLabels = {
    personal: t("profileEditModal.accountTypes.personal"),
    realtor: t("profileEditModal.accountTypes.realtor"),
    agency: t("profileEditModal.accountTypes.agency"),
    developer: t("profileEditModal.accountTypes.developer"),
  };

  const translatedAccountTypes = accountTypes.map(
    (role) => accountTypeLabels[role],
  );

  const selectedAccountTypeLabel =
    accountTypeLabels[selectedRole] || accountTypeLabels.personal;

  /*
   * =========================================================
   * SELECT NEW AVATAR
   * =========================================================
   */

  function uploadAvatar(e) {
    const file = e.target.files?.[0];

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert(t("profileEditModal.errors.imageSize"));
      return;
    }

    setAvatarFile(file);

    setAvatarRemoved(false);

    setAvatar(URL.createObjectURL(file));
  }

  /*
   * =========================================================
   * REMOVE AVATAR
   * =========================================================
   */

  function removeAvatar() {
    setAvatar(null);
    setAvatarFile(null);

    setAvatarRemoved(true);
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

      const token = localStorage.getItem("uytap_token");

      if (!token) {
        throw new Error(t("profileEditModal.errors.session"));
      }

      /*
       * -----------------------------------------------------
       * Avatar: обращаемся к серверу только если аватар менялся
       * -----------------------------------------------------
       */

      let refreshedProfile = {};

      if (avatarFile) {
        const uploadResult = await uploadAvatarRequest(token, avatarFile);

        refreshedProfile = uploadResult.profile || {};
      } else if (
        avatarRemoved &&
        initialAvatar &&
        !initialAvatar.startsWith("/assets/")
      ) {
        const deleteResult = await deleteAvatar(token);

        refreshedProfile = deleteResult.profile || {};
      }

      /*
       * -----------------------------------------------------
       * Saved avatar
       * -----------------------------------------------------
       */

      let savedAvatar;

      if (avatarRemoved) {
        savedAvatar =
          refreshedProfile.avatar_url ||
          refreshedProfile.avatar ||
          "/assets/personalImage.png";
      } else {
        savedAvatar =
          refreshedProfile.avatar_url ||
          refreshedProfile.avatar ||
          avatar ||
          initialAvatar ||
          "/assets/personalImage.png";
      }

      /*
       * -----------------------------------------------------
       * 2. Update additional profile data on server
       * -----------------------------------------------------
       */

      const payload = {
        firstName,
        lastName,
        phone,
        about,
        accountType: selectedRole,
      };

      if (selectedRole === "realtor") {
        payload.fullName = fullName;

        payload.inn = inn;

        payload.region = region;
      } else if (selectedRole === "agency" || selectedRole === "developer") {
        payload.companyName = companyName;

        payload.inn = inn;

        payload.officeAddress = officeAddress;

        payload.actualAddress = actualAddress;

        payload.website = website;
      }

      await updateMe(token, payload);

      /*
       * -----------------------------------------------------
       * 3. Fresh user from server & commit to local state
       * -----------------------------------------------------
       */

      const freshUser = await getMe(token);

      if (avatarRemoved) {
        freshUser.profile = {
          ...(freshUser.profile || {}),

          avatar_url:
            freshUser?.profile?.avatar_url || "/assets/personalImage.png",

          avatar: freshUser?.profile?.avatar || "/assets/personalImage.png",
        };
      }

      localStorage.setItem("uytap_user", JSON.stringify(freshUser));

      /*
       * -----------------------------------------------------
       * 4. Notify app that user updated
       * -----------------------------------------------------
       */

      try {
        window.dispatchEvent(
          new CustomEvent("uytap:user-updated", {
            detail: freshUser,
          }),
        );
      } catch (error) {
        console.warn("Could not dispatch user-updated event", error);
      }

      /*
       * -----------------------------------------------------
       * SUCCESS
       * -----------------------------------------------------
       */

      close();

      window.location.reload();
    } catch (error) {
      console.error("PROFILE SAVE ERROR:", error);

      alert(error?.message || t("profileEditModal.errors.save"));
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
          aria-label={t("profileEditModal.actions.close")}
        >
          <X />
        </button>

        <div className={styles.scroll}>
          {/* HEADER */}

          <header className={styles.header}>
            <h2>{t("profileEditModal.header.title")}</h2>

            <p>{t("profileEditModal.header.description")}</p>
          </header>

          {/* AVATAR */}

          <div className={styles.avatarBlock}>
            <div className={styles.avatarWrapper}>
              <div className={styles.avatar}>
                {avatar ? (
                  <img src={avatar} alt={t("profileEditModal.avatar.alt")} />
                ) : (
                  <User />
                )}
              </div>
            </div>

            <div className={styles.avatarActions}>
              <label className={styles.upload}>
                <Camera size={17} />

                <span>
                  {avatar
                    ? t("profileEditModal.avatar.change")
                    : t("profileEditModal.avatar.add")}
                </span>

                <input
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={uploadAvatar}
                  disabled={loading}
                />
              </label>

              {avatar && (
                <button
                  type="button"
                  className={styles.remove}
                  onClick={removeAvatar}
                  disabled={loading}
                >
                  <Trash2 size={17} />

                  <span>{t("profileEditModal.avatar.remove")}</span>
                </button>
              )}
            </div>
          </div>

          {/* FIELDS */}

          <div className={styles.fields}>
            {/* ACCOUNT TYPE */}

            {user?.accountType === "personal" && (
              <CustomSelect
                icon={UserRoundCog}
                title={t("profileEditModal.accountType.title")}
                options={translatedAccountTypes}
                value={selectedAccountTypeLabel}
                setValue={(selectedLabel) => {
                  const role = accountTypes.find(
                    (item) => accountTypeLabels[item] === selectedLabel,
                  );

                  setSelectedRole(role || "personal");
                }}
              />
            )}

            {/* PERSONAL */}

            {selectedRole === "personal" && (
              <div className={styles.row}>
                <div className={styles.inputBox}>
                  <User />

                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={t("profileEditModal.fields.firstName")}
                    disabled={loading}
                  />
                </div>

                <div className={styles.inputBox}>
                  <User />

                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder={t("profileEditModal.fields.lastName")}
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {/* REALTOR */}

            {selectedRole === "realtor" && (
              <>
                <div className={styles.inputBox}>
                  <User />

                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t("profileEditModal.fields.fullNameRequired")}
                    disabled={loading}
                  />
                </div>

                <div className={styles.inputBox}>
                  <Hash />

                  <input
                    value={inn}
                    onChange={(e) => setInn(e.target.value)}
                    placeholder={t("profileEditModal.fields.innRequired")}
                    disabled={loading}
                  />
                </div>

                <div className={styles.inputBox}>
                  <MapPin />

                  <input
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder={t("profileEditModal.fields.region")}
                    disabled={loading}
                  />
                </div>
              </>
            )}

            {/* AGENCY / DEVELOPER */}

            {(selectedRole === "agency" || selectedRole === "developer") && (
              <>
                <div className={styles.inputBox}>
                  <Building />

                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={t(
                      selectedRole === "agency"
                        ? "profileEditModal.fields.agencyNameRequired"
                        : "profileEditModal.fields.companyNameRequired",
                    )}
                    disabled={loading}
                  />
                </div>

                <div className={styles.inputBox}>
                  <Hash />

                  <input
                    value={inn}
                    onChange={(e) => setInn(e.target.value)}
                    placeholder={t("profileEditModal.fields.innRequired")}
                    disabled={loading}
                  />
                </div>

                <div className={styles.inputBox}>
                  <MapPin />

                  <input
                    value={officeAddress}
                    onChange={(e) => setOfficeAddress(e.target.value)}
                    placeholder={t(
                      "profileEditModal.fields.legalAddressRequired",
                    )}
                    disabled={loading}
                  />
                </div>

                <div className={styles.inputBox}>
                  <MapPin />

                  <input
                    value={actualAddress}
                    onChange={(e) => setActualAddress(e.target.value)}
                    placeholder={t("profileEditModal.fields.actualAddress")}
                    disabled={loading}
                  />
                </div>

                <div className={styles.inputBox}>
                  <Globe />

                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder={t("profileEditModal.fields.companyWebsite")}
                    disabled={loading}
                  />
                </div>
              </>
            )}

            {/* PHONE */}

            <div className={styles.inputBox}>
              <Phone />

              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("profileEditModal.fields.phoneRequired")}
                disabled={loading}
              />
            </div>

            {/* ABOUT */}

            <div className={styles.textarea}>
              <FileText />

              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder={t(
                  selectedRole === "personal"
                    ? "profileEditModal.fields.aboutPersonal"
                    : "profileEditModal.fields.aboutBusiness",
                )}
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
              ? t("profileEditModal.actions.saving")
              : t("profileEditModal.actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
