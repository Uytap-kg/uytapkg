"use client";

import AgencyPublicProfile from "./AgencyPublicProfile/AgencyPublicProfile";
import DeveloperPublicProfile from "./DeveloperPublicProfile/DeveloperPublicProfile";
import PersonalPublicProfile from "./PersonalPublicProfile/PersonalPublicProfile";
import RealtorPublicProfile from "./RealtorPublicProfile/RealtorPublicProfile";
import usePublicProfile from "@/hooks/usePublicProfile";
import { useLanguage } from "@/context/LanguageContext";

export default function PublicProfile({ profileId }) {
  const { t } = useLanguage();
  const { user, loading, error, favIds, handleFavoriteClick } =
    usePublicProfile(profileId);

  if (loading) {
    return (
      <main
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "60vh",
          color: "#666",
        }}
      >
        <div>{t("publicProfile.loading")}</div>
      </main>
    );
  }

  if (error || !user) {
    return (
      <main
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "60vh",
          color: "#e53e3e",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <h1>{t("publicProfile.notFound.title")}</h1>

        <p>{error || t("publicProfile.notFound.description")}</p>

        <a
          href="/"
          style={{
            color: "#3182ce",
            textDecoration: "underline",
          }}
        >
          {t("publicProfile.notFound.home")}
        </a>
      </main>
    );
  }

  const commonProps = {
    profile: user,
    user,
    isOwnProfile: false,
    favIds,
    onFavoriteClick: handleFavoriteClick,
  };

  switch (user.type) {
    case "agency":
      return <AgencyPublicProfile {...commonProps} />;

    case "developer":
      return <DeveloperPublicProfile {...commonProps} />;

    case "realtor":
      return <RealtorPublicProfile {...commonProps} />;

    case "personal":
      return <PersonalPublicProfile {...commonProps} />;

    default:
      return (
        <main>
          <h1>{t("publicProfile.unknownType")}</h1>
        </main>
      );
  }
}
