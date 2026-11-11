"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getUserPublicProfile,
  getFavorites,
  addFavorite,
  removeFavorite,
} from "@/utils/api";
import { useLanguage } from "@/context/LanguageContext";

// Загрузка публичного профиля (GET /api/auth/users/:id) + избранное текущего
// пользователя. Общая логика для /public-profile/[id] и /realtors/[id].
export default function usePublicProfile(profileId) {
  const { t } = useLanguage();
  const router = useRouter();
  const id = profileId ? String(profileId) : "";

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [favIds, setFavIds] = useState(() => new Set());

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    getUserPublicProfile(id)
      .then((res) => {
        if (cancelled) return;
        if (!res?.success || !res.user) {
          throw new Error(t("publicProfile.errors.load"));
        }

        const userData = res.user;
        // Списки дублируются в profile — так их ожидают компоненты профилей
        if (userData.profile) {
          userData.profile.complexes = userData.complexes || [];
          userData.profile.ads = userData.ads || [];
        }
        setUser(userData);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error loading public profile:", err);
        setError(err.message || t("publicProfile.errors.fetch"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, t]);

  useEffect(() => {
    const token = localStorage.getItem("uytap_token");
    if (!token) return;

    getFavorites(token)
      .then((res) => {
        if (res.success && res.data) {
          setFavIds(new Set(res.data.map((l) => l.id)));
        }
      })
      .catch((err) => console.error("Error loading favs:", err));
  }, []);

  const handleFavoriteClick = useCallback(
    async (clickedItem) => {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        router.push("/login");
        return;
      }

      const isFav = favIds.has(clickedItem.id);

      try {
        const res = isFav
          ? await removeFavorite(token, clickedItem.id)
          : await addFavorite(token, clickedItem.id);

        if (res.success) {
          setFavIds((prev) => {
            const next = new Set(prev);
            if (isFav) next.delete(clickedItem.id);
            else next.add(clickedItem.id);
            return next;
          });
        }
      } catch (err) {
        console.error("Favorite toggle error in public profile:", err);
      }
    },
    [favIds, router],
  );

  return { user, loading, error, favIds, handleFavoriteClick };
}
