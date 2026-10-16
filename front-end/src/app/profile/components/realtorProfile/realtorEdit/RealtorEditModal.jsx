"use client";

import { useState } from "react";

import {
  X,
  Camera,
  Phone,
  User,
  FileText,
  Check,
  Trash2,
  Building2,
  Globe,
  MapPin,
  Hash,
} from "lucide-react";

import styles from "./RealtorEditModal.module.css";

import {
  getMe,
  updateMe,
  uploadAvatar as uploadAvatarRequest,
  deleteAvatar,
} from "@/utils/api";
import { useLanguage } from "@/context/LanguageContext";

export default function RealtorEditModal({ user, close }) {
  const { t } = useLanguage();

  const profile = user?.profile || {};

  const initialAvatar =
    profile.avatar_url ||
    profile.avatar ||
    user?.avatar_url ||
    user?.avatar ||
    null;

  const DEFAULT_AVATAR = "/assets/realtorImage.png";

  const [loading, setLoading] = useState(false);

  const [firstName, setFirstName] = useState(profile.first_name || "");

  const [lastName, setLastName] = useState(profile.last_name || "");

  const [phone, setPhone] = useState(user?.phone || "");

  const [companyName, setCompanyName] = useState(profile.company_name || "");

  const [inn, setInn] = useState(profile.inn || "");

  const [website, setWebsite] = useState(profile.website || "");

  const [officeAddress, setOfficeAddress] = useState(
    profile.office_address || "",
  );

  const [about, setAbout] = useState(profile.about || "");

  const [avatar, setAvatar] = useState(initialAvatar || DEFAULT_AVATAR);

  const [avatarFile, setAvatarFile] = useState(null);

  // true только если пользователь реально нажал "Удалить фото"
  const [avatarRemoved, setAvatarRemoved] = useState(false);

  /*
   * =========================================================
   * AVATAR
   * =========================================================
   */

  function uploadAvatar(e) {
    const file = e.target.files?.[0];

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert(t("realtorEditModal.errors.imageSize"));

      return;
    }

    setAvatarFile(file);
    setAvatarRemoved(false);

    setAvatar(URL.createObjectURL(file));
  }

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
        throw new Error(t("realtorEditModal.errors.session"));
      }

      /*
       * Аватар: обращаемся к серверу только если он менялся
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

      let savedAvatar;

      if (avatarRemoved) {
        savedAvatar =
          refreshedProfile.avatar_url ||
          refreshedProfile.avatar ||
          DEFAULT_AVATAR;
      } else {
        savedAvatar =
          refreshedProfile.avatar_url ||
          refreshedProfile.avatar ||
          avatar ||
          initialAvatar ||
          DEFAULT_AVATAR;
      }

      /*
       * Собираем локального пользователя
       */

      const updatedUser = {
        ...user,

        phone,

        profile: {
          ...(user?.profile || {}),

          ...refreshedProfile,

          first_name: firstName,
          last_name: lastName,

          company_name: companyName,

          inn,
          website,

          office_address: officeAddress,

          about,

          avatar_url: savedAvatar,

          avatar: savedAvatar,
        },
      };

      /*
       * Сохраняем локально
       */

      localStorage.setItem("uytap_user", JSON.stringify(updatedUser));

      /*
       * Сообщаем приложению,
       * что пользователь обновился
       */

      try {
        window.dispatchEvent(
          new CustomEvent("uytap:user-updated", {
            detail: updatedUser,
          }),
        );
      } catch (error) {
        console.warn("Could not dispatch user-updated event", error);
      }

      /*
       * Обновляем обычные данные пользователя
       */

      await updateMe(token, {
        firstName,
        lastName,
        phone,
        companyName,
        inn,
        website,
        officeAddress,
        about,
      });

      /*
       * Получаем полностью свежего пользователя
       */

      const freshUser = await getMe(token);

      /*
       * Если аватар удалён,
       * гарантируем fallback на фронте.
       */

      if (avatarRemoved) {
        freshUser.profile = {
          ...(freshUser.profile || {}),

          avatar_url: freshUser?.profile?.avatar_url || DEFAULT_AVATAR,

          avatar: freshUser?.profile?.avatar || DEFAULT_AVATAR,
        };
      }

      localStorage.setItem("uytap_user", JSON.stringify(freshUser));

      /*
       * Закрываем modal
       */

      close();

      /*
       * Перезагружаем страницу
       */

      window.location.reload();
    } catch (error) {
      console.error("REALTOR PROFILE SAVE ERROR:", error);

      alert(error?.message || t("realtorEditModal.errors.save"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <button
          type="button"
          className={styles.close}
          onClick={close}
          disabled={loading}
          aria-label={t("realtorEditModal.actions.close")}
        >
          <X />
        </button>

        <div className={styles.scroll}>
          {/* HEADER */}

          <header className={styles.header}>
            <h2>{t("realtorEditModal.header.title")}</h2>

            <p>{t("realtorEditModal.header.description")}</p>
          </header>

          {/* AVATAR */}

          <div className={styles.avatarBlock}>
            <div className={styles.avatarWrapper}>
              <div className={styles.avatar}>
                {avatar ? (
                  <img src={avatar} alt={t("realtorEditModal.avatar.alt")} />
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
                    ? t("realtorEditModal.avatar.change")
                    : t("realtorEditModal.avatar.add")}
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

                  <span>{t("realtorEditModal.avatar.remove")}</span>
                </button>
              )}
            </div>
          </div>

          {/* FIELDS */}

          <div className={styles.fields}>
            {/* Имя + фамилия */}

            <div className={styles.row}>
              <div className={styles.inputBox}>
                <User />

                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={t("realtorEditModal.fields.firstName")}
                  disabled={loading}
                />
              </div>

              <div className={styles.inputBox}>
                <User />

                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={t("realtorEditModal.fields.lastName")}
                  disabled={loading}
                />
              </div>
            </div>

            {/* Агентство */}

            <div className={styles.inputBox}>
              <Building2 />

              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t("realtorEditModal.fields.companyName")}
                disabled={loading}
              />
            </div>

            {/* Телефон */}

            <div className={styles.inputBox}>
              <Phone />

              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("realtorEditModal.fields.phone")}
                disabled={loading}
              />
            </div>

            {/* ИНН */}

            <div className={styles.inputBox}>
              <Hash />

              <input
                value={inn}
                onChange={(e) => setInn(e.target.value)}
                placeholder={t("realtorEditModal.fields.inn")}
                disabled={loading}
              />
            </div>

            {/* Сайт */}

            <div className={styles.inputBox}>
              <Globe />

              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder={t("realtorEditModal.fields.website")}
                disabled={loading}
              />
            </div>

            {/* Адрес */}

            <div className={styles.inputBox}>
              <MapPin />

              <input
                value={officeAddress}
                onChange={(e) => setOfficeAddress(e.target.value)}
                placeholder={t("realtorEditModal.fields.officeAddress")}
                disabled={loading}
              />
            </div>

            {/* ABOUT */}

            <div className={styles.textarea}>
              <FileText />

              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder={t("realtorEditModal.fields.about")}
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
              ? t("realtorEditModal.actions.saving")
              : t("realtorEditModal.actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
