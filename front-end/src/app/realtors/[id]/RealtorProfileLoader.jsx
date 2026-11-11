"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import usePublicProfile from "@/hooks/usePublicProfile";
import { useLanguage } from "@/context/LanguageContext";
import RealtorsProfile from "./RealtorsProfile";
import styles from "./RealtorsProfile.module.css";

export default function RealtorProfileLoader({ profileId }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, loading, error, favIds, handleFavoriteClick } =
    usePublicProfile(profileId);

  const isOtherAccountType = Boolean(user && user.type !== "realtor");

  // /realtors/[id] — только для риэлторов; остальные профили открываем
  // на общей странице публичного профиля.
  useEffect(() => {
    if (isOtherAccountType) {
      router.replace(`/public-profile/${encodeURIComponent(user.id)}`);
    }
  }, [isOtherAccountType, router, user]);

  if (loading || isOtherAccountType) {
    return (
      <main className={styles.statusScreen}>
        <p>{t("publicProfile.loading")}</p>
      </main>
    );
  }

  if (error || !user) {
    return (
      <main className={styles.statusScreen}>
        <h1>{t("publicProfile.notFound.title")}</h1>
        <p>{error || t("publicProfile.notFound.description")}</p>
        <Link href="/realtors">{t("realtorsPage.backToList")}</Link>
      </main>
    );
  }

  return (
    <RealtorsProfile
      user={user}
      favIds={favIds}
      onFavoriteClick={handleFavoriteClick}
    />
  );
}
